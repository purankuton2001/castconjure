import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { CLIPS_DIR, ROOT, saveSettings, sanitizeSettings } from '../config.js';
import type { Pipeline } from '../queue/pipeline.js';
import type { Settings, WsServerMessage } from '../types.js';

const PUBLIC = path.join(ROOT, 'public');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.png': 'image/png',
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
        if (p === '/api/state') return json(res, { settings: pipeline.settings, state: pipeline.publicState(), logs: pipeline.recentLogs(), backend: pipeline.effectiveBackend, metricsFile: pipeline.metrics.file });
        if (p === '/api/settings') return json(res, pipeline.settings);
        if (p === '/health') return json(res, { ok: true });
        return notFound(res);
      }
      if (req.method === 'POST') {
        const body = (await readJson(req)) as Record<string, unknown>;
        if (p === '/api/settings') {
          const next = sanitizeSettings({ ...pipeline.settings, ...(body as Partial<Settings>), character: { ...pipeline.settings.character, ...((body.character as Settings['character']) ?? {}) } });
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
    send(ws, pipeline.currentVisual());
    ws.on('message', (raw) => {
      try {
        const m = JSON.parse(String(raw)) as { type: string; id?: string };
        if (m.type === 'ended' && m.id) pipeline.playbackEnded(m.id, 'overlay');
        if (m.type === 'sync') {
          send(ws, { type: 'state', state: pipeline.publicState() });
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

function sendFile(res: http.ServerResponse, file: string, ranged = false): void {
  if (!fs.existsSync(file)) return notFound(res);
  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const size = fs.statSync(file).size;
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Cache-Control': ranged ? 'public, max-age=3600' : 'no-store', 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new Error('body too large'));
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
