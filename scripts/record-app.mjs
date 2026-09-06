#!/usr/bin/env node
/**
 * End-to-end app demo recording: starts the real server (`npm start`, PORT 8788) and shows its stdout in a
 * terminal panel, opens the control panel and the OBS overlay side by side, then drives the panel like a
 * user (click Start, type comments, click Send) while headless Chrome records. Each reaction clip's audio
 * is mixed in at the frame where it appears in the overlay region (frame matching), so the result has sound.
 *
 *   node scripts/record-app.mjs --comments "dance!!|what's your favorite food?|好きな季節は？" --out docs/app-demo.mp4
 *
 * Needs: ffmpeg, Pillow, Google Chrome, FAL_KEY in .env. Costs one reaction clip per comment.
 */
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('port', '8788'));
const BASE = `http://127.0.0.1:${PORT}`;
const comments = opt('comments', 'dance!!|what\'s your favorite food?').split('|').map((s) => s.trim()).filter(Boolean);
const authors = opt('authors', 'taro_k|mika|yujin|ren|さくら|kazu').split('|');
const out = path.resolve(opt('out', 'docs/app-demo.mp4'));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const W = 1280, H = 720;
// overlay region on the demo page (see public/demo.html): 800×450 at (16,48)
const OV = { x: 16, y: 48, w: 800, h: 450 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, body) => (await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-app-'));
let server = null, browser = null;
const cleanup = () => { try { server?.kill('SIGINT'); } catch {} };
process.on('exit', cleanup); process.on('SIGINT', () => { cleanup(); process.exit(130); }); process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1); }); process.on('unhandledRejection', (e) => { console.error(e); cleanup(); process.exit(1); });
browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
const tCtx = Date.now();
const page = await context.newPage();
await page.goto('file://' + path.join(ROOT, 'public', 'demo.html'));
await sleep(800);

// 1) start the real server and stream its stdout into the terminal panel
await page.evaluate(() => window.termType('npm start'));
await page.evaluate(() => window.termLine(''));
server = spawn('npm', ['start'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), AUTOSTART: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
const onLine = (buf) => { for (const line of buf.toString().split('\n')) { if (line.trim()) page.evaluate((l) => window.termLine(l), line.replace(/\x1b\[[0-9;]*m/g, '')).catch(() => {}); } };
server.stdout.on('data', onLine); server.stderr.on('data', onLine);
let up = false;
for (let i = 0; i < 100 && !up; i++) { await sleep(300); try { up = (await fetch(BASE + '/health')).ok; } catch {} }
if (!up) { server.kill(); throw new Error('server did not start'); }
await sleep(600);
await page.evaluate((b) => window.boot(b), BASE);
await sleep(3500); // panel + overlay load, idle loop starts

// 2) drive the control panel like a user
const cfg = page.frameLocator('#cfgf');
const cfgFrame = () => page.frames().find((f) => f.url().startsWith(BASE) && !f.url().includes('/overlay'));
const clickIn = (id) => cfgFrame().evaluate((i) => { const el = document.getElementById(i); el.focus(); el.click(); }, id);
await clickIn('bStart');
await page.evaluate(() => window.termLine('▶ Start pressed in the control panel', 'd'));
await sleep(1500);

const st = await api('/api/state');
const seenIds = new Set([...st.state.recent, ...st.state.queue].map((j) => j.id));
const events = [];
for (let i = 0; i < comments.length; i++) {
  const comment = comments[i], author = authors[i % authors.length];
  await cfgFrame().evaluate((a) => { const el = document.getElementById('cAuthor'); el.value = a; el.dispatchEvent(new Event('input')); }, author);
  await cfgFrame().evaluate(() => { const el = document.getElementById('cText'); el.value = ''; el.focus(); });
  for (const ch of comment) { await cfgFrame().evaluate((c) => { const el = document.getElementById('cText'); el.value += c; el.dispatchEvent(new Event('input')); }, ch); await sleep(55); }
  await sleep(400);
  const tComment = Date.now();
  await clickIn('bSend');
  await page.evaluate((l) => window.termLine(l, 'd'), `chat  ${author}: ${comment}`);
  const ev = { author, comment, tComment, tGen: 0, tPlay: 0, tEnd: 0, reply: '', jobId: '', clipUrl: '', plays: [] };
  for (let k = 0; k < 600; k++) {
    await sleep(200);
    const s = (await api('/api/state')).state;
    const mine = (j) => j.text === comment && !seenIds.has(j.id);
    const gen = s.queue.find((j) => mine(j) && j.status === 'generating');
    if (gen && !ev.tGen) ev.tGen = Date.now();
    const cur = s.current && mine(s.current) ? s.current : null;
    if (cur && !ev.plays.some((p) => p.id === cur.id)) {
      ev.plays.push({ id: cur.id, isAck: !!cur.isAck, clipUrl: cur.clipUrl || '', tPlay: Date.now(), reply: cur.reply || '' });
      if (cur.isAck) { console.log(`   ack clip on screen after ${((Date.now() - tComment) / 1000).toFixed(1)}s`); page.evaluate((l) => window.termLine(l, 'd'), `she noticed the comment (ack clip) · ${((Date.now() - tComment) / 1000).toFixed(1)}s`).catch(() => {}); }
      else { ev.tPlay = Date.now(); ev.reply = cur.reply || ''; ev.clipUrl = cur.clipUrl || ''; ev.jobId = cur.id; console.log(`${i + 1}/${comments.length} "${comment}" → reaction on screen after ${((ev.tPlay - tComment) / 1000).toFixed(1)}s, reply "${ev.reply}"`); page.evaluate((l) => window.termLine(l, 'd'), `reply ${ev.reply}   ·   reaction on screen ${((ev.tPlay - tComment) / 1000).toFixed(1)}s`).catch(() => {}); }
    }
    if (ev.tPlay && !cur) { ev.tEnd = Date.now(); break; }
    const failed = s.recent.find((j) => mine(j) && j.status === 'failed');
    if (failed && !ev.tPlay) { console.error(`generation failed for "${comment}":`, failed.error || ''); page.evaluate((l) => window.termLine(l, 'd'), `generation failed: ${(failed.error || '').slice(0, 80)}`).catch(() => {}); break; }
  }
  if (ev.tPlay) { events.push(ev); seenIds.add(ev.jobId); }
  await sleep(2500);
}
await sleep(2000);
const video = page.video();
await context.close();
await browser.close();
server.kill('SIGINT');
const webm = await video.path();

// 3) align each clip's audio to where the clip appears inside the overlay region, then mix + captions
const rel = (t) => (t - tCtx) / 1000;
const crop = `${OV.x}:${OV.y}:${OV.w}:${OV.h}`;
const out_events = [];
const clipPath = (u, jobId) => u.startsWith('/personas/') ? path.resolve(ROOT, 'data/personas', decodeURIComponent(u.slice('/personas/'.length))) : path.resolve(ROOT, 'data/clips', u.startsWith('/clips/') ? path.basename(u) : `${jobId}.mp4`);
for (const ev of events) {
  for (const pl of ev.plays) {
    const clipFile = clipPath(pl.clipUrl, pl.id);
    let tPlay = rel(pl.tPlay);
    if (fs.existsSync(clipFile)) {
      const alArgs = [path.join(ROOT, 'scripts/align-clip.py'), '--rec', webm, '--clip', clipFile, '--approx', tPlay.toFixed(2)];
      if (typeof crop !== 'undefined') alArgs.push('--crop', crop);
      const al = spawnSync('python3', alArgs, { encoding: 'utf8' });
      const v = parseFloat(al.stdout.trim());
      if (Number.isFinite(v)) { console.log(`aligned ${pl.isAck ? 'ack' : 'reaction'} "${ev.comment}": api ${tPlay.toFixed(2)}s → frames ${v.toFixed(2)}s`); tPlay = v; }
    }
    const ackFile = pl.isAck ? '' : path.resolve(ROOT, 'data/clips', `${pl.id}.reply.mp3`);
    out_events.push({
      author: ev.author, comment: ev.comment, reply: pl.isAck ? '' : ev.reply, isAck: pl.isAck,
      latency: ((pl.tPlay - ev.tComment) / 1000).toFixed(1),
      tComment: rel(ev.tComment), tGen: pl.isAck ? null : (ev.tGen ? rel(ev.tGen) : null), tPlay, tAck: null,
      audio: fs.existsSync(clipFile) ? clipFile : null, ackAudio: ackFile && fs.existsSync(ackFile) ? ackFile : null, cost: pl.isAck ? '$0' : '$0.25',
    });
  }
}
const evFile = path.join(tmp, 'events.json');
fs.writeFileSync(evFile, JSON.stringify(out_events, null, 2));
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = spawnSync('python3', [path.join(ROOT, 'scripts/burn-captions.py'), '--in', webm, '--out', out, '--events', evFile, '--minimal'], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('burn-captions failed');
console.log(JSON.stringify({ out, webm, events: evFile, clips: out_events.map((e) => ({ comment: e.comment, reply: e.reply, latency: e.latency, tPlay: e.tPlay.toFixed(2) })) }, null, 2));
