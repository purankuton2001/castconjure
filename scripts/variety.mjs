#!/usr/bin/env node
/**
 * Try a variety of comments through the running server and cut the results into one montage:
 * each reaction clip (with its own audio) captioned with the comment, the reply and the latency.
 *
 *   node scripts/variety.mjs --out docs/variety.mp4 --comments "sing a song|jump!!|eat ramen|make a heart|spin around|let's go to the beach"
 *
 * Costs one reaction clip per comment on the configured backend. Needs ffmpeg + Pillow (burn-captions.py).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:8787');
const out = path.resolve(opt('out', 'docs/variety.mp4'));
const comments = opt('comments', "sing a song|jump!!|eat ramen|make a heart|spin around|let's go to the beach").split('|').map((s) => s.trim()).filter(Boolean);
const authors = ['mika', 'taro_k', 'ren', 'sora', 'kazu', 'yujin', 'noa', 'leo'];
const api = async (p, body) => (await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();

// no rate limits for the batch; remember the old values
const before = await api('/api/settings');
await api('/api/settings', { minIntervalSec: 0, userCooldownSec: 0, maxQueue: 20 });
await api('/api/control', { action: 'start' });

const results = [];
for (let i = 0; i < comments.length; i++) {
  const comment = comments[i], author = authors[i % authors.length];
  const t0 = Date.now();
  const posted = await api('/api/comment', { text: comment, author });
  if (!posted.ok) { console.log(`skip "${comment}": ${posted.error}`); continue; }
  let job = null;
  for (let k = 0; k < 900; k++) {
    await new Promise((r) => setTimeout(r, 300));
    const s = (await api('/api/state')).state;
    const done = s.recent.find((j) => j.text === comment && (j.status === 'done' || j.status === 'failed'));
    const cur = s.current && s.current.text === comment ? s.current : null;
    if (cur && !job) { job = { ...cur, latency: (Date.now() - t0) / 1000 }; console.log(`${i + 1}/${comments.length} "${comment}" → on screen after ${job.latency.toFixed(1)}s, reply "${cur.reply}"`); }
    if (done) { if (!job) job = { ...done, latency: (Date.now() - t0) / 1000 }; break; }
  }
  if (!job || job.status === 'failed' || !job.clipUrl) { console.log(`failed "${comment}"`); continue; }
  results.push({ ...job, author, comment });
}
await api('/api/settings', { minIntervalSec: before.minIntervalSec, userCooldownSec: before.userCooldownSec, maxQueue: before.maxQueue });

// local clip files (cached in the background; wait briefly if needed)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-variety-'));
const parts = [];
for (const r of results) {
  let file = path.resolve('data/clips', `${r.id}.mp4`);
  for (let k = 0; k < 40 && !fs.existsSync(file); k++) await new Promise((res) => setTimeout(res, 500));
  if (!fs.existsSync(file)) {
    file = path.join(tmp, `${r.id}.mp4`);
    fs.writeFileSync(file, Buffer.from(await (await fetch(r.clipUrl)).arrayBuffer()));
  }
  const captioned = path.join(tmp, `${r.id}.cap.mp4`);
  const cap = spawnSync('python3', ['scripts/burn-captions.py', '--in', file, '--out', captioned, '--comment', r.comment, '--author', r.author, '--t-comment', '0', '--t-play', '0', '--latency', r.latency.toFixed(1), '--reply', r.reply || '', '--keep-audio'], { stdio: 'inherit' });
  if (cap.status !== 0) throw new Error('caption failed');
  parts.push(captioned);
}
const list = path.join(tmp, 'list.txt');
fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n'));
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:v', 'libx264', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('concat failed');
console.log(JSON.stringify({ out, clips: results.map((x) => ({ comment: x.comment, reply: x.reply, latency: x.latency.toFixed(1), action: x.action })) }, null, 2));
