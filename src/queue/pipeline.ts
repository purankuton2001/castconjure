import fs from 'node:fs';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { CLIPS_DIR, secrets } from '../config.js';
import { createBackend } from '../backend/index.js';
import type { ChatAdapter } from '../chat/adapter.js';
import { ManualAdapter } from '../chat/manual.js';
import { YouTubeAdapter } from '../chat/youtube.js';
import { NgFilter } from '../filter/ngfilter.js';
import { Selector } from '../filter/selector.js';
import { MetricsLogger } from '../metrics/logger.js';
import { buildIdlePrompt, buildPrompt } from '../prompt/builder.js';
import { generateReply } from '../reply/llm.js';
import { loadPersona, personaDir, personaUrl, referenceImageUris, referenceVoiceUri, savePersona } from '../persona/store.js';
import type { ChatMessage, GenerateBackend, GenerateRequest, Job, Persona, PublicJob, PublicState, Settings, WsServerMessage } from '../types.js';

type Listener = (msg: WsServerMessage) => void;

/**
 * The core loop (v0.7): comment -> filter/select -> (reply) -> prompt -> generate -> queue -> play,
 * over an always-on idle pool of the persona. Domain-agnostic plumbing; the persona and settings carry the rest.
 */
export class Pipeline {
  settings: Settings;
  readonly metrics = new MetricsLogger();
  private ng = new NgFilter();
  private selector = new Selector();
  private backend: GenerateBackend;
  private adapter?: ChatAdapter;
  private manual = new ManualAdapter();
  private jobs = new Map<string, Job>();
  private order: string[] = [];
  private current?: Job;
  private playTimer?: NodeJS.Timeout;
  private listeners = new Set<Listener>();
  private logLines: { level: 'info' | 'warn' | 'error'; line: string; t: number }[] = [];
  private seq = 0;
  private persona: Persona | null = null;
  private refCache?: { id: string; images: string[]; voice?: string; stamp: string };
  private idleJob?: { running: boolean; done: number; total: number; abort: AbortController };

  running = false;
  paused = false;
  chatConnected = false;
  chatInfo = 'not started';
  spentUsd = 0;
  budgetExhausted = false;
  stats = { received: 0, filtered: 0, generated: 0, failed: 0, played: 0 };

  constructor(settings: Settings) {
    this.settings = settings;
    this.backend = this.safeBackend(settings.backend);
    this.reloadPersona();
    this.metrics.log('boot', { backend: this.backend.name, platform: settings.platform, persona: this.persona?.id ?? null });
  }

  // ---------- wiring ----------
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private broadcast(msg: WsServerMessage): void {
    for (const l of this.listeners) l(msg);
  }
  private pushState(): void {
    this.broadcast({ type: 'state', state: this.publicState() });
  }
  log(level: 'info' | 'warn' | 'error', line: string): void {
    const rec = { level, line, t: Date.now() };
    this.logLines.push(rec);
    if (this.logLines.length > 200) this.logLines.shift();
    console[level === 'info' ? 'log' : level](`[${level}] ${line}`);
    this.broadcast({ type: 'log', line, level });
  }
  recentLogs() {
    return this.logLines.slice(-80);
  }

  private safeBackend(name: Settings['backend']): GenerateBackend {
    try {
      return createBackend(name);
    } catch (e) {
      this.log('error', `backend "${name}" unavailable: ${(e as Error).message}. Falling back to mock.`);
      return createBackend('mock');
    }
  }

  get effectiveBackend(): string {
    return this.backend.name;
  }

  // ---------- persona ----------
  get activePersona(): Persona | null {
    return this.persona;
  }

  reloadPersona(): Persona | null {
    this.persona = this.settings.personaId ? loadPersona(this.settings.personaId) : null;
    this.refCache = undefined;
    this.broadcast({ type: 'persona', persona: this.persona });
    this.broadcast(this.idlePoolMessage());
    return this.persona;
  }

  /** Reference data URIs, cached per persona + file mtimes. */
  private refs(): { images: string[]; voice?: string } {
    const p = this.persona;
    if (!p) return { images: [] };
    const files = [p.references.face, p.references.full, p.references.scene, p.references.voice].filter(Boolean) as string[];
    const stamp = files
      .map((f) => {
        try {
          return String(fs.statSync(path.join(personaDir(p.id), f)).mtimeMs);
        } catch {
          return '0';
        }
      })
      .join(',');
    if (!this.refCache || this.refCache.id !== p.id || this.refCache.stamp !== stamp) {
      this.refCache = { id: p.id, images: referenceImageUris(p), voice: referenceVoiceUri(p), stamp };
    }
    return { images: this.refCache.images, voice: this.refCache.voice };
  }

  idlePoolMessage(): WsServerMessage {
    const p = this.persona;
    const clips = (p?.idle?.clips ?? []).map((c) => ({ url: c.kind === 'video' ? personaUrl(p!.id, c.file) : '', kind: c.kind }));
    return { type: 'idlePool', persona: { id: p?.id ?? '', name: p?.name ?? '', fanName: p?.fanName }, clips };
  }

  private request(prompt: string, audio = this.settings.audio): GenerateRequest {
    const r = this.refs();
    return { prompt, durationSec: this.settings.durationSec, resolution: this.settings.resolution, referenceImageUrls: r.images, referenceAudioUrl: r.voice, audio };
  }

  /** Cost of one reaction clip with the current persona/backend. */
  estimateClipCostUsd(): number {
    return this.backend.estimateCostUsd(this.request(''));
  }

  /** F-13: generate the idle pool. Runs in the background; progress via state. */
  async generateIdlePool(count: number): Promise<void> {
    const p = this.persona;
    if (!p) throw new Error('no persona selected');
    if (this.idleJob?.running) throw new Error('idle pool generation already running');
    const abort = new AbortController();
    this.idleJob = { running: true, done: 0, total: count, abort };
    const dir = path.join(personaDir(p.id), 'idle');
    fs.mkdirSync(dir, { recursive: true });
    p.idle = { ...(p.idle ?? {}), clips: [] };
    savePersona(p);
    this.metrics.log('idle_pool_start', { persona: p.id, count, backend: this.backend.name, estimateUsd: this.estimateClipCostUsd() * count });
    this.pushState();
    try {
      for (let i = 0; i < count; i++) {
        if (abort.signal.aborted) break;
        const prompt = buildIdlePrompt(i, this.settings, p, this.refs().images.length);
        const t0 = Date.now();
        try {
          const res = await this.backend.generate(this.request(prompt, false), abort.signal);
          let file = '';
          if (res.kind === 'video') {
            file = `idle/${String(i + 1).padStart(2, '0')}.mp4`;
            await downloadTo(res.clipUrl, path.join(personaDir(p.id), file));
          }
          p.idle!.clips.push({ file, kind: res.kind, prompt, costUsd: res.costUsd });
          savePersona(p);
          this.spentUsd += res.costUsd;
          this.metrics.log('idle_clip_done', { persona: p.id, index: i, genMs: res.genMs, costUsd: res.costUsd, kind: res.kind });
        } catch (e) {
          this.metrics.log('idle_clip_failed', { persona: p.id, index: i, error: (e as Error).message, ms: Date.now() - t0 });
          this.log('error', `idle clip ${i + 1} failed: ${(e as Error).message}`);
        }
        this.idleJob.done = i + 1;
        this.pushState();
      }
    } finally {
      this.idleJob.running = false;
      this.log('info', `idle pool: ${p.idle!.clips.length}/${count} clips ready`);
      this.metrics.log('idle_pool_done', { persona: p.id, clips: p.idle!.clips.length, spentUsd: this.spentUsd });
      this.broadcast(this.idlePoolMessage());
      this.pushState();
    }
  }

  cancelIdlePool(): void {
    this.idleJob?.abort.abort();
  }

  // ---------- settings ----------
  async updateSettings(next: Settings): Promise<void> {
    const prev = this.settings;
    this.settings = next;
    if (prev.backend !== next.backend) {
      this.backend = this.safeBackend(next.backend);
      this.log('info', `backend switched to ${this.backend.name}`);
    }
    if (prev.personaId !== next.personaId) this.reloadPersona();
    this.metrics.log('settings', { ...next });
    this.broadcast({ type: 'settings', settings: next });
    if (this.running && (prev.platform !== next.platform || prev.youtubeVideoId !== next.youtubeVideoId)) {
      await this.stopAdapter();
      await this.startAdapter();
    }
    this.pushState();
  }

  // ---------- lifecycle ----------
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.spentUsd = 0;
    this.budgetExhausted = false;
    this.stats = { received: 0, filtered: 0, generated: 0, failed: 0, played: 0 };
    this.selector.reset();
    this.metrics.log('session_start', { ...this.settings, backend: this.backend.name, persona: this.persona?.id ?? null, idleClips: this.persona?.idle?.clips.length ?? 0 });
    await this.startAdapter();
    this.pushState();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this.stopAdapter();
    this.metrics.log('session_stop', { spentUsd: this.spentUsd, ...this.stats });
    this.pushState();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.metrics.log(p ? 'paused' : 'resumed');
    if (!p) this.pump();
    this.pushState();
  }

  resetBudget(): void {
    this.spentUsd = 0;
    this.budgetExhausted = false;
    this.metrics.log('budget_reset');
    this.pump();
    this.pushState();
  }

  private async startAdapter(): Promise<void> {
    const s = this.settings;
    const adapter: ChatAdapter =
      s.platform === 'youtube'
        ? new YouTubeAdapter({
            apiKey: secrets.youtubeApiKey,
            videoId: s.youtubeVideoId,
            unitsPerPoll: secrets.youtubeUnitsPerPoll,
            minPollMs: secrets.youtubeMinPollMs,
            onMetric: (ev, f) => this.metrics.log(ev, f),
          })
        : this.manual;
    this.adapter = adapter;
    try {
      await adapter.start({
        onMessage: (m) => this.handleMessage(m),
        onStatus: (c, info) => {
          this.chatConnected = c;
          this.chatInfo = info;
          this.metrics.log('chat_status', { connected: c, info });
          this.pushState();
        },
        onLog: (lv, line) => this.log(lv, line),
      });
    } catch (e) {
      this.chatConnected = false;
      this.chatInfo = `error: ${(e as Error).message}`;
      this.log('error', `chat adapter failed: ${(e as Error).message}`);
    }
  }

  private async stopAdapter(): Promise<void> {
    await this.adapter?.stop();
    this.adapter = undefined;
    this.chatConnected = false;
  }

  inject(text: string, author: string, opts: { isOwner?: boolean; isModerator?: boolean }): ChatMessage {
    const now = Date.now();
    const msg: ChatMessage = {
      id: `manual-${now}-${++this.seq}`,
      platform: 'manual',
      authorName: author || 'tester',
      authorId: `manual:${author || 'tester'}`,
      text,
      publishedAt: now,
      receivedAt: now,
      isModerator: !!opts.isModerator,
      isOwner: !!opts.isOwner,
    };
    this.handleMessage(msg);
    return msg;
  }

  // ---------- intake ----------
  handleMessage(msg: ChatMessage): void {
    this.stats.received++;
    this.metrics.log('comment_received', { id: msg.id, platform: msg.platform, author: msg.authorName, len: msg.text.length });
    const s = this.settings;

    if (msg.text.trim().toLowerCase().startsWith(s.approveCommand.toLowerCase())) {
      if (!msg.isModerator && !msg.isOwner) return this.reject(msg, 'command');
      const arg = msg.text.trim().slice(s.approveCommand.length).trim();
      const pending = this.order.map((id) => this.jobs.get(id)!).filter((j) => j.status === 'pending_approval');
      const target = arg ? pending.find((j) => j.id.startsWith(arg) || j.message.authorName === arg.replace(/^@/, '')) : pending.at(-1);
      if (target) this.approve(target.id, msg.authorName);
      return;
    }

    if (!this.running) return this.reject(msg, 'paused');
    const sel = this.selector.consider(msg, s);
    if (!sel.ok) return this.reject(msg, sel.reason);
    const ngReason = this.ng.check(sel.text, s.ngWords, s.maxCommentChars);
    if (ngReason) return this.reject(msg, ngReason);
    if (this.activeCount() >= s.maxQueue) return this.reject(msg, 'queue_full');

    const estimate = this.estimateClipCostUsd();
    if (this.spentUsd + estimate > s.budgetUsd) {
      if (!this.budgetExhausted) {
        this.budgetExhausted = true;
        this.log('warn', `budget exhausted: spent $${this.spentUsd.toFixed(2)} of $${s.budgetUsd}`);
        this.metrics.log('budget_exhausted', { spentUsd: this.spentUsd, budgetUsd: s.budgetUsd });
        this.pushState();
      }
      return this.reject(msg, 'budget_exhausted');
    }

    this.selector.markAccepted(msg);
    const job: Job = {
      id: `j${Date.now().toString(36)}${(++this.seq).toString(36)}`,
      message: { ...msg, text: sel.text },
      prompt: '',
      status: s.approvalMode ? 'pending_approval' : 'queued',
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.order.push(job.id);
    if (this.order.length > 200) {
      const old = this.order.shift()!;
      this.jobs.delete(old);
    }
    this.metrics.log('comment_selected', { job: job.id, id: msg.id, author: msg.authorName, text: sel.text, approval: s.approvalMode });
    this.log('info', `selected [${job.id}] ${msg.authorName}: ${sel.text}${s.approvalMode ? ' (awaiting approval)' : ''}`);
    if (!s.approvalMode) this.pump();
    this.pushState();
  }

  private reject(msg: ChatMessage, reason: string): void {
    this.stats.filtered++;
    this.metrics.log('comment_filtered', { id: msg.id, author: msg.authorName, reason });
  }

  approve(jobId: string, by = 'ui'): boolean {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== 'pending_approval') return false;
    job.status = 'queued';
    job.approvedAt = Date.now();
    this.metrics.log('approved', { job: jobId, by });
    this.log('info', `approved [${jobId}] by ${by}`);
    this.pump();
    this.pushState();
    return true;
  }

  rejectJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job || (job.status !== 'pending_approval' && job.status !== 'queued')) return false;
    job.status = 'rejected';
    this.metrics.log('rejected', { job: jobId });
    this.pushState();
    return true;
  }

  /** F-09: streamer's subjective consistency rating (1–5) for a clip. */
  rate(jobId: string, score: number, note?: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    this.metrics.log('consistency_rating', { job: jobId, score: Math.max(1, Math.min(5, Math.round(score))), note, backend: job.result?.backend, refImages: this.refs().images.length });
    return true;
  }

  // ---------- generation ----------
  private activeCount(): number {
    let n = 0;
    for (const id of this.order) {
      const st = this.jobs.get(id)?.status;
      if (st === 'queued' || st === 'generating' || st === 'ready') n++;
    }
    return n;
  }
  private generatingCount(): number {
    return this.order.filter((id) => this.jobs.get(id)?.status === 'generating').length;
  }

  private pump(): void {
    if (this.paused) return;
    while (this.generatingCount() < secrets.maxConcurrentGen) {
      const next = this.order.map((id) => this.jobs.get(id)!).find((j) => j.status === 'queued');
      if (!next) break;
      void this.runJob(next);
    }
  }

  private async runJob(job: Job): Promise<void> {
    const s = this.settings;
    const estimate = this.estimateClipCostUsd();
    if (this.spentUsd + estimate > s.budgetUsd) {
      job.status = 'failed';
      job.error = 'budget';
      this.budgetExhausted = true;
      this.pushState();
      return;
    }
    job.status = 'generating';
    job.genStartAt = Date.now();
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), secrets.genTimeoutMs);

    // F-14 reply mode: one line in the persona's voice, NG-filtered, with a safe fallback.
    if (s.replyMode && this.persona) {
      try {
        const r = await generateReply({ persona: this.persona, author: job.message.authorName, comment: job.message.text }, ac.signal);
        const blocked = this.ng.check(r.text, s.ngWords, 200, { allowNames: true });
        job.reply = blocked ? fallbackLine(this.persona) : r.text;
        job.replyMs = r.ms;
        this.metrics.log('reply_done', { job: job.id, provider: r.provider, ms: r.ms, blocked: blocked ?? null, chars: [...job.reply].length });
      } catch (e) {
        job.reply = fallbackLine(this.persona);
        this.metrics.log('reply_failed', { job: job.id, error: (e as Error).message });
        this.log('warn', `reply failed, using fallback: ${(e as Error).message}`);
      }
    }
    const refs = this.refs();
    job.prompt = buildPrompt({ comment: job.message.text, reply: job.reply, refCount: refs.images.length, hasVoice: !!refs.voice }, s, this.persona);
    const req = this.request(job.prompt);
    this.metrics.log('gen_start', { job: job.id, backend: this.backend.name, resolution: s.resolution, durationSec: s.durationSec, refImages: refs.images.length, voice: !!refs.voice && s.audio, estimateUsd: estimate, promptLen: job.prompt.length });
    if (!this.current) this.broadcast({ type: 'generating', job: this.toPublic(job) });
    this.pushState();

    try {
      const result = await this.backend.generate(req, ac.signal);
      job.genDoneAt = Date.now();
      if (result.kind === 'video' && result.backend === 'fal' && secrets.cacheClips) {
        result.clipUrl = await this.cacheClip(job.id, result.clipUrl);
      }
      job.result = result;
      job.status = 'ready';
      this.spentUsd += result.costUsd;
      this.stats.generated++;
      this.metrics.log('gen_done', {
        job: job.id,
        backend: result.backend,
        genMs: result.genMs,
        totalMs: job.genDoneAt - job.genStartAt!,
        sinceReceivedMs: job.genDoneAt - job.message.receivedAt,
        costUsd: result.costUsd,
        spentUsd: this.spentUsd,
        clipUrl: result.clipUrl,
        reply: job.reply,
        expandedPrompt: result.expandedPrompt,
        raw: result.raw,
      });
      this.log('info', `generated [${job.id}] in ${(result.genMs / 1000).toFixed(1)}s ($${result.costUsd.toFixed(3)})${job.reply ? ` — "${job.reply}"` : ''}`);
    } catch (e) {
      job.status = 'failed';
      job.error = (e as Error).message;
      this.stats.failed++;
      this.metrics.log('gen_failed', { job: job.id, error: job.error, ms: Date.now() - job.genStartAt! });
      this.log('error', `generation failed [${job.id}]: ${job.error}`);
      if (!this.current) this.broadcast({ type: 'idle' });
    } finally {
      clearTimeout(timeout);
    }
    this.pushState();
    this.pumpPlay();
    this.pump();
  }

  private async cacheClip(jobId: string, url: string): Promise<string> {
    try {
      fs.mkdirSync(CLIPS_DIR, { recursive: true });
      const file = `${jobId}.mp4`;
      await downloadTo(url, path.join(CLIPS_DIR, file));
      return `/clips/${file}`;
    } catch (e) {
      this.log('warn', `clip cache failed, using remote url: ${(e as Error).message}`);
      return url;
    }
  }

  // ---------- playback ----------
  private pumpPlay(): void {
    if (this.current) return;
    const next = this.order.map((id) => this.jobs.get(id)!).find((j) => j.status === 'ready');
    if (!next) {
      const gen = this.order.map((id) => this.jobs.get(id)!).find((j) => j.status === 'generating');
      this.broadcast(gen ? { type: 'generating', job: this.toPublic(gen) } : { type: 'idle' });
      return;
    }
    this.current = next;
    next.status = 'playing';
    next.playStartAt = Date.now();
    this.metrics.log('play_start', {
      job: next.id,
      sinceReceivedMs: next.playStartAt - next.message.receivedAt,
      sinceGenDoneMs: next.playStartAt - (next.genDoneAt ?? next.playStartAt),
    });
    this.broadcast({ type: 'play', job: this.toPublic(next) });
    this.playTimer = setTimeout(() => this.playbackEnded(next.id, 'timeout'), (this.settings.durationSec + 4) * 1000);
    this.pushState();
  }

  playbackEnded(jobId: string, source = 'overlay'): void {
    const job = this.jobs.get(jobId);
    if (!job || this.current?.id !== jobId) return;
    if (this.playTimer) clearTimeout(this.playTimer);
    job.status = 'done';
    job.playEndAt = Date.now();
    this.stats.played++;
    this.metrics.log('play_end', { job: jobId, source, playMs: job.playEndAt - (job.playStartAt ?? job.playEndAt) });
    this.current = undefined;
    this.pushState();
    this.pumpPlay();
  }

  currentVisual(): WsServerMessage {
    if (this.current) return { type: 'play', job: this.toPublic(this.current) };
    const gen = this.order.map((id) => this.jobs.get(id)!).find((j) => j.status === 'generating');
    return gen ? { type: 'generating', job: this.toPublic(gen) } : { type: 'idle' };
  }

  // ---------- views ----------
  toPublic(j: Job): PublicJob {
    return {
      id: j.id,
      authorName: j.message.authorName,
      text: j.message.text,
      prompt: j.prompt,
      reply: j.reply,
      status: j.status,
      clipUrl: j.result?.clipUrl,
      kind: j.result?.kind,
      durationSec: this.settings.durationSec,
      showAiBadge: this.settings.showAiBadge,
    };
  }

  publicState(): PublicState {
    const all = this.order.map((id) => this.jobs.get(id)!);
    const p = this.persona;
    const r = this.refs();
    return {
      running: this.running,
      paused: this.paused,
      chatConnected: this.chatConnected,
      chatInfo: this.chatInfo,
      spentUsd: this.spentUsd,
      budgetUsd: this.settings.budgetUsd,
      budgetExhausted: this.budgetExhausted,
      pending: all.filter((j) => j.status === 'pending_approval').map((j) => this.toPublic(j)),
      queue: all.filter((j) => j.status === 'queued' || j.status === 'generating' || j.status === 'ready').map((j) => this.toPublic(j)),
      current: this.current ? this.toPublic(this.current) : undefined,
      recent: all
        .filter((j) => j.status === 'done' || j.status === 'failed' || j.status === 'rejected')
        .slice(-10)
        .reverse()
        .map((j) => this.toPublic(j)),
      stats: { ...this.stats },
      youtube: this.adapter?.stats?.() as PublicState['youtube'],
      persona: p ? { id: p.id, name: p.name, refs: r.images.length, voice: !!r.voice, idleClips: p.idle?.clips.length ?? 0, confirmed: !!p.references.confirmed } : undefined,
      idleJob: this.idleJob ? { running: this.idleJob.running, done: this.idleJob.done, total: this.idleJob.total } : undefined,
    };
  }
}

function fallbackLine(p: Persona): string {
  return p.personality.verbalTics?.[0] ?? 'やってみよ！';
}

async function downloadTo(url: string, file: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  await streamPipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), fs.createWriteStream(file));
}
