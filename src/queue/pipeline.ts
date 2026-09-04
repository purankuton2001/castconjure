import fs from 'node:fs';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { CLIPS_DIR, secrets } from '../config.js';
import { createBackend, resolveReferenceImages } from '../backend/index.js';
import type { ChatAdapter } from '../chat/adapter.js';
import { ManualAdapter } from '../chat/manual.js';
import { YouTubeAdapter } from '../chat/youtube.js';
import { NgFilter } from '../filter/ngfilter.js';
import { Selector } from '../filter/selector.js';
import { MetricsLogger } from '../metrics/logger.js';
import { buildPrompt } from '../prompt/builder.js';
import type { ChatMessage, GenerateBackend, Job, PublicJob, PublicState, Settings, WsServerMessage } from '../types.js';

type Listener = (msg: WsServerMessage) => void;

/**
 * The core loop: comment -> filter/select -> prompt -> generate -> queue -> play.
 * Domain-agnostic plumbing; everything stream-specific lives in Settings.
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
    this.metrics.log('boot', { backend: this.backend.name, platform: settings.platform });
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

  // ---------- settings ----------
  async updateSettings(next: Settings): Promise<void> {
    const prev = this.settings;
    this.settings = next;
    if (prev.backend !== next.backend) {
      this.backend = this.safeBackend(next.backend);
      this.log('info', `backend switched to ${this.backend.name}`);
    }
    this.metrics.log('settings', { ...redact(next) });
    this.broadcast({ type: 'settings', settings: next });
    if (this.running && (prev.platform !== next.platform || prev.youtubeVideoId !== next.youtubeVideoId)) {
      await this.stopAdapter();
      await this.startAdapter();
    }
    this.pushState();
  }

  get effectiveBackend(): string {
    return this.backend.name;
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
    this.metrics.log('session_start', { ...redact(this.settings), backend: this.backend.name });
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

  /** Dev/manual injection (config UI "test comment"). Works even when platform=youtube. */
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

    // Approval command: "!ok" (latest pending) or "!ok <jobId prefix | author>". Only mods/owner; viewers' copies are dropped silently.
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

    const refs = resolveReferenceImages(s.character.referenceImages);
    const estimate = this.backend.estimateCostUsd({ prompt: '', durationSec: s.durationSec, resolution: s.resolution, referenceImageUrls: refs, audio: s.audio });
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
    const prompt = buildPrompt(sel.text, s, refs.length > 0);
    const job: Job = {
      id: `j${Date.now().toString(36)}${(++this.seq).toString(36)}`,
      message: { ...msg, text: sel.text },
      prompt,
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
    const refs = resolveReferenceImages(s.character.referenceImages);
    const req = { prompt: job.prompt, durationSec: s.durationSec, resolution: s.resolution, referenceImageUrls: refs, audio: s.audio };
    const estimate = this.backend.estimateCostUsd(req);
    if (this.spentUsd + estimate > s.budgetUsd) {
      job.status = 'failed';
      job.error = 'budget';
      this.budgetExhausted = true;
      this.pushState();
      return;
    }
    job.status = 'generating';
    job.genStartAt = Date.now();
    this.metrics.log('gen_start', { job: job.id, backend: this.backend.name, resolution: s.resolution, durationSec: s.durationSec, refImages: refs.length, estimateUsd: estimate, promptLen: job.prompt.length });
    if (!this.current) this.broadcast({ type: 'generating', job: this.toPublic(job) });
    this.pushState();

    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), secrets.genTimeoutMs);
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
        expandedPrompt: result.expandedPrompt,
        raw: result.raw,
      });
      this.log('info', `generated [${job.id}] in ${(result.genMs / 1000).toFixed(1)}s ($${result.costUsd.toFixed(3)})`);
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
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
      await streamPipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), fs.createWriteStream(path.join(CLIPS_DIR, file)));
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
    // Fallback in case the overlay never reports "ended" (not connected, OBS reload...).
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

  /** Called when an overlay (re)connects: replay the current visual state. */
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
      status: j.status,
      clipUrl: j.result?.clipUrl,
      kind: j.result?.kind,
      durationSec: this.settings.durationSec,
      showAiBadge: this.settings.showAiBadge,
    };
  }

  publicState(): PublicState {
    const all = this.order.map((id) => this.jobs.get(id)!);
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
    };
  }
}

function redact(s: Settings): Record<string, unknown> {
  return { ...s, character: { ...s.character, referenceImages: s.character.referenceImages.length } };
}
