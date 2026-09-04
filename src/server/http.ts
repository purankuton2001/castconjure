import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { CLIPS_DIR, PERSONAS_DIR, ROOT, saveSettings, sanitizeSettings } from '../config.js';
import { FACE_SAFETY_SUFFIX, adoptCandidate, createImageGen, gachaDir, saveCandidate, saveRef } from '../persona/facegen.js';
import { createPersona, fileDataUri, listPersonas, loadPersona, savePersona } from '../persona/store.js';
import { generateVoice } from '../persona/voice.js';
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

export function createServer(pipeline: Pipeline, port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const p = url.pathname;
      if (req.method === 'GET') {
        if (p === '/' || p === '/config') return sendFile(res, path.join(PUBLIC, 'config.html'));
        if (p === '/overlay') return sendFile(res, path.join(PUBLIC, 'overlay.html'));
        if (p.startsWith('/clips/')) return sendFile(res, path.join(CLIPS_DIR, path.basename(p)), true);
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
          const prompt = `${base}. ${cur?.referencePrompts?.suffix ?? ''} ${FACE_SAFETY_SUFFIX}`.replace(/\s+/g, ' ');
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
          const suffix = `${cur.referencePrompts?.suffix ?? ''} ${FACE_SAFETY_SUFFIX}`;
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
          const text = String(body.text ?? '').trim() || cur.voice?.sampleLine || `こんにちは、${cur.name}です。今日もよろしくね。`;
          const r = await generateVoice(cur.id, text, cur.voice?.description);
          cur.references.voice = r.rel;
          cur.voice = { ...(cur.voice ?? {}), sampleLine: text };
          savePersona(cur);
          pipeline.reloadPersona();
          pipeline.metrics.log('voice_generated', { persona: cur.id, backend: r.backend, costUsd: r.costUsd });
          return json(res, { persona: pipeline.activePersona, costUsd: r.costUsd, backend: r.backend });
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
