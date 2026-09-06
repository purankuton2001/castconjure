#!/usr/bin/env node
/**
 * Record the live overlay reacting to real comments: headless Chrome (Playwright, channel 'chrome') opens
 * /overlay, comments are posted through the API one after another, and the recording captures
 * idle → (subtitle) → generating → reaction clip → back to idle, for each comment.
 * Audio: recordings are silent, so each reaction clip's own audio is mixed in at the exact frame where the
 * clip appears in the recording (frame matching, scripts/align-clip.py), plus the instant-reply voice.
 *
 *   node scripts/record-live.mjs --comments "dance!!|eat ramen|make a heart|let's go to the beach" --out docs/live.mp4
 *
 * Needs: server on BASE, ffmpeg, Pillow, Google Chrome. Costs one reaction clip per comment.
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:8787');
// --replay "file.mp4:comment text|file2.mp4:text" plays cached clips instead of generating (no cost; overlay/sync tests)
const replays = opt('replay', '').split('|').map((s) => s.trim()).filter(Boolean).map((s) => { const i = s.indexOf(':'); return { file: s.slice(0, i), text: s.slice(i + 1) }; });
const comments = replays.length ? replays.map((r) => r.text) : (opt('comments', '') || opt('comment', 'dance!!')).split('|').map((s) => s.trim()).filter(Boolean);
const authors = (opt('authors', 'taro_k|mika|ren|sora|kazu|yujin')).split('|');
const out = path.resolve(opt('out', 'docs/live.mp4'));
const lang = opt('lang', 'en');
const gapMs = Number(opt('gap', '2500'));
const W = 1280, H = 720;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const api = async (p, body) => (await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const st = await api('/api/state');
console.log(`persona=${st.state.persona?.name} idle=${st.state.persona?.idleClips} backend=${st.backend} mode=${st.settings.genMode} audio=${st.settings.audio} reply=${st.settings.replyMode}`);
const before = await api('/api/settings');
await api('/api/settings', { minIntervalSec: 0, userCooldownSec: 0 });
await api('/api/control', { action: 'start' });
const seenIds = new Set([...st.state.recent, ...st.state.queue].map((j) => j.id));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-live-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
const tCtx = Date.now();
const page = await context.newPage();
await page.goto(`${BASE}/overlay?lang=${lang}`, { waitUntil: 'load' });
await sleep(4000); // let the idle loop settle

const events = [];
for (let i = 0; i < comments.length; i++) {
  const comment = comments[i], author = authors[i % authors.length];
  const tComment = Date.now();
  const posted = replays.length ? await api('/api/replay', { file: replays[i].file, text: comment, author, reply: `${author}, let's do it!` }) : await api('/api/comment', { text: comment, author });
  if (!posted.ok) { console.log(`skip "${comment}": ${posted.error}`); continue; }
  const ev = { author, comment, tComment, tGen: 0, tAck: 0, tPlay: 0, tEnd: 0, reply: '', jobId: '', clipUrl: '', plays: [] };
  for (let k = 0; k < 600; k++) {
    await sleep(200);
    const s = (await api('/api/state')).state;
    const mine = (j) => j.text === comment && !seenIds.has(j.id);
    const gen = s.queue.find((j) => mine(j) && j.status === 'generating');
    if (gen && !ev.tGen) ev.tGen = Date.now();
    const ack = [...s.queue, ...(s.current ? [s.current] : [])].find((j) => mine(j) && j.ackVoiceUrl);
    if (ack && !ev.tAck) ev.tAck = Date.now();
    const cur = s.current && mine(s.current) ? s.current : null;
    if (cur && !ev.plays.some((p) => p.id === cur.id)) {
      ev.plays.push({ id: cur.id, isAck: !!cur.isAck, clipUrl: cur.clipUrl || '', tPlay: Date.now(), reply: cur.reply || '' });
      if (cur.isAck) console.log(`   ack clip on screen after ${((Date.now() - tComment) / 1000).toFixed(1)}s`);
      else { ev.tPlay = Date.now(); ev.reply = cur.reply || ''; ev.clipUrl = cur.clipUrl || ''; ev.jobId = cur.id; console.log(`${i + 1}/${comments.length} "${comment}" → reaction on screen after ${((ev.tPlay - tComment) / 1000).toFixed(1)}s, reply "${ev.reply}"`); }
    }
    if (ev.tPlay && !cur) { ev.tEnd = Date.now(); break; }
    const failed = s.recent.find((j) => mine(j) && j.status === 'failed');
    if (failed && !ev.tPlay) { console.error(`generation failed for "${comment}":`, failed.error || ''); break; }
  }
  if (ev.tPlay) { events.push(ev); seenIds.add(ev.jobId); }
  await sleep(gapMs);
}
await sleep(2000);
const video = page.video();
await context.close();
await browser.close();
await api('/api/settings', { minIntervalSec: before.minIntervalSec, userCooldownSec: before.userCooldownSec });
const webm = await video.path();

// per event: cached clip file (playback used the CDN URL; the cache lands a few seconds later), then frame-align the clip
const rel = (t) => (t - tCtx) / 1000;
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
const r = spawnSync('python3', [path.join(ROOT, 'scripts/burn-captions.py'), '--in', webm, '--out', out, '--events', evFile], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('burn-captions failed');
console.log(JSON.stringify({ out, events: out_events.map((e) => ({ comment: e.comment, reply: e.reply, latency: e.latency, tPlay: e.tPlay.toFixed(2), audio: !!e.audio, ack: !!e.ackAudio })) }, null, 2));
