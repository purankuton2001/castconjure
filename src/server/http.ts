import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { CLIPS_DIR, PERSONAS_DIR, ROOT, saveSettings, sanitizeSettings } from '../config.js';
import { FACE_SAFETY_SUFFIX, STYLE_SUFFIX, adoptCandidate, createImageGen, gachaDir, saveCandidate, saveRef } from '../persona/facegen.js';
import { IpGuard } from '../filter/ipguard.js';
import { createPersona, fileDataUri, listPersonas, loadPersona, savePersona } from '../persona/store.js';
import { VOICE_SAMPLES, generateVoice } from '../persona/voice.js';
import type { Pipeline } from '../queue/pipeline.js';
import type { Persona, Settings, WsServerMessage } from '../types.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
};

const ipGuard = new IpGuard();

/** F-16 on the generation side: persona text and gacha prompts must not name real idols or existing IP. */
function ipHit(fields: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(fields)) {
    const text = Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '';
    const m = text && ipGuard.match(text);
    if (m) return `${k}: "${m}"`;
  }
  return null;
}

export function createServer(pipeline: Pipeline, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const p = url.pathname;
      if (req.method === 'GET') {
        if (p === '/' || p === '/config') return sendFile(res, path.join(PUBLIC, 'config.html'));
        if (p === '/overlay') return sendFile(res, path.join(PUBLIC, 'overlay.html'));
        if (p.startsWith('/clips/')) {
          const file = path.join(CLIPS_DIR, path.basename(p));
          if (fs.existsSync(file)) return sendFile(res, file, true);
          const remote = pipeline.remoteClipUrl(path.basename(p).replace(/\.mp4$/, ''));
          if (remote) return proxy(res, remote);
          return notFound(res);
        }
        if (p.startsWith('/personas/')) {
          const rel = decodeURIComponent(p.slice('/personas/'.length));
          const abs = path.normalize(path.join(PERSONAS_DIR, rel));
          if (!abs.startsWith(PERSONAS_DIR + path.sep)) return notFound(res);
          return sendFile(res, abs, true);
        }
        if (p === '/api/state') return json(res, { settings: pipeline.settings, state: pipeline.publicState(), logs: pipeline.recentLogs(), backend: pipeline.effectiveBackend, metricsFile: pipeline.metrics.file, persona: pipeline.activePersona, personas: listPersonas().map((x) => ({ id: x.id, name: x.name })) });
        if (p === '/api/settings') return json(res, pipeline.settings);
        if (p === '/api/personas') return json(res, listPersonas());
        if (p === '/api/persona') return json(res, pipeline.activePersona);
        if (p === '/api/persona/gacha') return json(res, listCandidates());
        if (p === '/api/persona/idle/estimate') {
          const count = Number(url.searchParams.get('count') ?? pipeline.settings.idlePoolSize);
          return json(res, { count, perClipUsd: pipeline.estimateClipCostUsd(), totalUsd: pipeline.estimateClipCostUsd() * count, backend: pipeline.effectiveBackend });
        }
        if (p === '/health') return json(res, { ok: true });
        return notFound(res);
      }
      if (req.method === 'POST') {
        const body = (await readJson(req)) as Record<string, unknown>;
        if (p === '/api/settings') {
          const next = sanitizeSettings({ ...pipeline.settings, ...(body as Partial<Settings>) });
          await pipeline.updateSettings(next);
          saveSettings(next);
          return json(res, next);
        }
        if (p === '/api/comment') {
          const text = String(body.text ?? '').trim();
          if (!text) return json(res, { error: 'text required' }, 400);
          const msg = pipeline.inject(text, String(body.author ?? 'tester'), { isOwner: !!body.owner, isModerator: !!body.moderator });
          return json(res, { ok: true, id: msg.id });
        }
        if (p === '/api/approve') return json(res, { ok: pipeline.approve(String(body.id ?? ''), 'ui') });
        if (p === '/api/reject') return json(res, { ok: pipeline.rejectJob(String(body.id ?? '')) });
        if (p === '/api/rate') return json(res, { ok: pipeline.rate(String(body.id ?? ''), Number(body.score ?? 0), body.note ? String(body.note) : undefined) });
        if (p === '/api/played') {
          pipeline.playbackEnded(String(body.id ?? ''), 'overlay-http');
          return json(res, { ok: true });
        }
        if (p === '/api/control') {
          const action = String(body.action ?? '');
          if (action === 'start') await pipeline.start();
          else if (action === 'stop') await pipeline.stop();
          else if (action === 'pause') pipeline.setPaused(true);
          else if (action === 'resume') pipeline.setPaused(false);
          else if (action === 'reset-budget') pipeline.resetBudget();
          else return json(res, { error: 'unknown action' }, 400);
          return json(res, { ok: true, state: pipeline.publicState() });
        }

        // ---------- persona (F-10 … F-13) ----------
        if (p === '/api/persona/create') {
          const id = String(body.id ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
          const name = String(body.name ?? '').trim();
          if (!id || !name) return json(res, { error: 'id and name required' }, 400);
          if (loadPersona(id)) return json(res, { error: 'persona exists' }, 409);
          const persona = createPersona(id, name);
          await selectPersona(pipeline, id);
          return json(res, persona);
        }
        if (p === '/api/persona/select') {
          const id = String(body.id ?? '');
          if (!loadPersona(id)) return json(res, { error: 'not found' }, 404);
          await selectPersona(pipeline, id);
          return json(res, pipeline.activePersona);
        }
        if (p === '/api/persona/save') {
          const cur = pipeline.activePersona;
          if (!cur) return json(res, { error: 'no persona' }, 400);
          const patch = body as Partial<Persona>;
          // references, idle and id are managed by the server; everything else is editable (F-12).
          const { references: _r, idle: _i, id: _id, ...editable } = patch;
          const merged: Persona = { ...cur, ...editable, id: cur.id, references: cur.references, idle: cur.idle, adult: true, appearance: { ...cur.appearance, ...(patch.appearance ?? {}) }, personality: { ...cur.personality, ...(patch.personality ?? {}) } };
          merged.style = merged.style === 'anime' ? 'anime' : 'photoreal';
          const hit = ipHit({ name: merged.name, appearance: merged.appearance.summary, signatures: merged.appearance.signatures ?? [], worldPrompt: merged.worldPrompt ?? '', replySystemPrompt: merged.replySystemPrompt ?? '' });
          if (hit) return json(res, { error: `Real idols and existing characters can't be used (${hit}). Your own original character only.` }, 400);
          savePersona(merged);
          pipeline.reloadPersona();
          pipeline.metrics.log('persona_saved', { persona: cur.id });
          return json(res, pipeline.activePersona);
        }
        if (p === '/api/persona/gacha') {
          const cur = pipeline.activePersona;
          const gen = createImageGen();
          const count = Math.max(1, Math.min(8, Number(body.count ?? 4)));
          const base = String(body.prompt ?? '').trim() || cur?.referencePrompts?.face || cur?.appearance.summary || 'portrait of a friendly young woman';
          const hit = ipHit({ prompt: base });
          if (hit) return json(res, { error: `Real idols and existing characters can't be used (${hit}). Describe your own original character.` }, 400);
          const style = STYLE_SUFFIX[cur?.style === 'anime' ? 'anime' : 'photoreal'];
          const prompt = `${base}. ${cur?.referencePrompts?.suffix ?? ''} ${style}, ${FACE_SAFETY_SUFFIX}`.replace(/\s+/g, ' ');
          const out: { file: string; url: string; seed: number }[] = [];
          let cost = 0;
          for (let i = 0; i < count; i++) {
            const seed = Math.floor(Math.random() * 1e9);
            const r = await gen.generate(prompt, seed);
            cost += r.costUsd;
            const file = saveCandidate(r.bytes, r.ext);
            out.push({ file, url: `/personas/_gacha/${file}`, seed });
          }
          pipeline.metrics.log('gacha', { persona: cur?.id ?? null, count, backend: gen.name, costUsd: cost, promptLen: prompt.length });
          return json(res, { candidates: out, prompt, costUsd: cost, backend: gen.name });
        }
        if (p === '/api/persona/adopt') {
          const cur = pipeline.activePersona;
          if (!cur) return json(res, { error: 'no persona' }, 400);
          const candidate = String(body.candidate ?? '');
          const gen = createImageGen();
          const faceRel = adoptCandidate(cur.id, candidate);
          const faceUri = fileDataUri(cur.id, faceRel)!;
          const suffix = `${cur.referencePrompts?.suffix ?? ''} ${STYLE_SUFFIX[cur.style === 'anime' ? 'anime' : 'photoreal']}, ${FACE_SAFETY_SUFFIX}`;
          const fullPrompt = `Full-body photo of the same person as in the input image, identical face and hair. ${cur.referencePrompts?.full ?? cur.appearance.defaultOutfit ?? ''}. ${suffix}`;
          const scenePrompt = `The same person as in the input image, identical face and hair, ${cur.referencePrompts?.scene ?? cur.appearance.defaultScene ?? 'in her room'}. ${suffix}`;
          let cost = 0;
          const full = await gen.edit(faceUri, fullPrompt, 1);
          const fullRel = saveRef(cur.id, 'full', full.bytes, full.ext);
          const scene = await gen.edit(faceUri, scenePrompt, 2);
          const sceneRel = saveRef(cur.id, 'scene', scene.bytes, scene.ext);
          cost += full.costUsd + scene.costUsd;
          cur.references = { ...cur.references, face: faceRel, full: fullRel, scene: sceneRel, confirmed: false, note: 'Generated in-app (F-10). Never a photo of a real person.' };
          savePersona(cur);
          pipeline.reloadPersona();
          pipeline.metrics.log('refs_derived', { persona: cur.id, backend: gen.name, costUsd: cost });
          return json(res, { persona: pipeline.activePersona, costUsd: cost });
        }
        if (p === '/api/persona/confirm') {
          const cur = pipeline.activePersona;
          if (!cur) return json(res, { error: 'no persona' }, 400);
          cur.references.confirmed = !!body.confirmed;
          savePersona(cur);
          pipeline.reloadPersona();
          pipeline.metrics.log('refs_confirmed', { persona: cur.id, confirmed: cur.references.confirmed });
          return json(res, pipeline.activePersona);
        }
        if (p === '/api/persona/voice') {
          const cur = pipeline.activePersona;
          if (!cur) return json(res, { error: 'no persona' }, 400);
          const lang = ['en', 'ko', 'ja'].includes(String(body.lang)) ? String(body.lang) : 'ja';
          const text = String(body.text ?? '').trim() || (lang === 'ja' && cur.voice?.sampleLine) || VOICE_SAMPLES[lang];
          const r = await generateVoice(cur.id, text, cur.voice?.description, lang, cur.voice?.customVoiceId);
          cur.references.voices = { ...(cur.references.voices ?? {}), [lang]: r.rel };
          if (!cur.references.voice || lang === 'ja') cur.references.voice = r.rel;
          if (lang === 'ja') cur.voice = { ...(cur.voice ?? {}), sampleLine: text };
          savePersona(cur);
          pipeline.reloadPersona();
          pipeline.metrics.log('voice_generated', { persona: cur.id, backend: r.backend, costUsd: r.costUsd, lang });
          return json(res, { persona: pipeline.activePersona, costUsd: r.costUsd, backend: r.backend, lang });
        }
        if (p === '/api/persona/idle') {
          if (body.action === 'cancel') {
            pipeline.cancelIdlePool();
            return json(res, { ok: true });
          }
          const count = Math.max(1, Math.min(60, Number(body.count ?? pipeline.settings.idlePoolSize)));
          void pipeline.generateIdlePool(count).catch((e) => pipeline.log('error', `idle pool: ${(e as Error).message}`));
          return json(res, { ok: true, count, estimateUsd: pipeline.estimateClipCostUsd() * count });
        }
        return notFound(res);
      }
      notFound(res);
    } catch (e) {
      json(res, { error: (e as Error).message }, 500);
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    send(ws, { type: 'hello', settings: pipeline.settings, state: pipeline.publicState() });
    send(ws, pipeline.idlePoolMessage());
    send(ws, pipeline.currentVisual());
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw)) as { type: string; id?: string };
        if (m.type === 'ended' && m.id) pipeline.playbackEnded(m.id, 'overlay');
        if (m.type === 'sync') {
          send(ws, { type: 'state', state: pipeline.publicState() });
          send(ws, pipeline.idlePoolMessage());
          send(ws, pipeline.currentVisual());
        }
      } catch {
        /* ignore */
      }
    });
  });
  pipeline.subscribe((msg) => {
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) send(c, msg);
  });

  server.listen(port, '127.0.0.1');
  return server;
}

async function selectPersona(pipeline: Pipeline, id: string): Promise<void> {
  const next = sanitizeSettings({ ...pipeline.settings, personaId: id });
  await pipeline.updateSettings(next);
  saveSettings(next);
}

function listCandidates(): { file: string; url: string }[] {
  return fs
    .readdirSync(gachaDir())
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort()
    .reverse()
    .slice(0, 24)
    .map((file) => ({ file, url: `/personas/_gacha/${file}` }));
}

function send(ws: WebSocket, msg: WsServerMessage): void {
  ws.send(JSON.stringify(msg));
}

function json(res: http.ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Stream a remote clip through this origin (used until the local cache file exists). */
async function proxy(res: http.ServerResponse, url: string): Promise<void> {
  try {
    const r = await fetch(url);
    if (!r.ok || !r.body) return notFound(res);
    res.writeHead(200, { 'Content-Type': r.headers.get('content-type') ?? 'video/mp4', ...(r.headers.get('content-length') ? { 'Content-Length': r.headers.get('content-length')! } : {}), 'Cache-Control': 'no-cache' });
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(value)) await new Promise((ok) => res.once('drain', ok));
    }
    res.end();
  } catch {
    if (!res.headersSent) notFound(res);
    else res.end();
  }
}

function notFound(res: http.ServerResponse): void {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

function sendFile(res: http.ServerResponse, file: string, cacheable = false): void {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound(res);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const size = fs.statSync(file).size;
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': cacheable ? 'no-cache' : 'no-store', 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}
