#!/usr/bin/env node
/**
 * Record the live overlay reacting to a comment, for real: headless Chrome (Playwright, `channel: 'chrome'`)
 * opens /overlay, a comment is posted through the API, and the recording captures idle → generating →
 * reaction clip (with subtitle) → back to idle. Timestamps are measured from the API and burned in.
 *
 *   node scripts/record-live.mjs --comment "dance!!" --author taro_k --out docs/live.mp4
 *
 * Needs: the server running on BASE (default http://127.0.0.1:8787), ffmpeg, Pillow, and Google Chrome installed
 * (Playwright uses it via channel 'chrome'; point Playwright's ffmpeg at the system one:
 *  ln -sf "$(which ffmpeg)" ~/Library/Caches/ms-playwright/ffmpeg-<version>/ffmpeg-mac  — or run `npx playwright install ffmpeg`).
 * Costs one reaction clip on the configured backend.
 */
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const BASE = opt('base', 'http://127.0.0.1:8787');
const comment = opt('comment', 'dance!!');
const author = opt('author', 'taro_k');
const out = path.resolve(opt('out', 'docs/live.mp4'));
const lang = opt('lang', 'en');
const W = 1280, H = 720;

const api = async (p, body) => (await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();

const st = await api('/api/state');
console.log(`persona=${st.state.persona?.name} idle=${st.state.persona?.idleClips} backend=${st.backend} audio=${st.settings.audio} reply=${st.settings.replyMode}`);
await api('/api/control', { action: 'start' });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-live-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: tmp, size: { width: W, height: H } } });
const tCtx = Date.now();
const page = await context.newPage();
await page.goto(`${BASE}/overlay?lang=${lang}`, { waitUntil: 'load' });
await page.waitForTimeout(4000); // let the idle loop settle

const tComment = Date.now();
const posted = await api('/api/comment', { text: comment, author });
console.log('comment posted', posted);

let tGen = 0, tPlay = 0, tEnd = 0, reply = '', clipUrl = '';
for (let i = 0; i < 600; i++) {
  await page.waitForTimeout(200);
  const s = (await api('/api/state')).state;
  const gen = s.queue.find((j) => j.status === 'generating');
  if (gen && !tGen) tGen = Date.now();
  if (s.current && !tPlay) { tPlay = Date.now(); reply = s.current.reply || ''; clipUrl = s.current.clipUrl || ''; console.log(`playing after ${((tPlay - tComment) / 1000).toFixed(1)}s reply="${reply}" clip=${clipUrl}`); }
  if (tPlay && !s.current) { tEnd = Date.now(); break; }
  const failed = s.recent.find((j) => j.status === 'failed');
  if (failed && !tPlay) { console.error('generation failed:', failed); break; }
}
await page.waitForTimeout(3000);
const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();

// burn in captions (Pillow + ffmpeg overlay; no drawtext dependency)
const rel = (t) => ((t - tCtx) / 1000).toFixed(2);
const latency = tPlay ? ((tPlay - tComment) / 1000).toFixed(1) : '?';
fs.mkdirSync(path.dirname(out), { recursive: true });
const cap = ['scripts/burn-captions.py', '--in', webm, '--out', out, '--comment', comment, '--author', author, '--t-comment', rel(tComment), '--latency', latency];
if (tGen) cap.push('--t-gen', rel(tGen));
if (tPlay) cap.push('--t-play', rel(tPlay));
if (reply) cap.push('--reply', reply);
// recordings are silent: mix the reaction clip's own audio in at playback start
const clipFile = clipUrl.startsWith('/clips/') ? path.resolve('data/clips', path.basename(clipUrl)) : '';
if (clipFile && fs.existsSync(clipFile)) cap.push('--audio', clipFile);
const r = spawnSync('python3', cap, { stdio: 'inherit', cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), '..') });
if (r.status !== 0) throw new Error('burn-captions failed');
console.log(JSON.stringify({ out, comment, author, reply, latencySec: latency, generatingAt: tGen ? rel(tGen) : null, playAt: tPlay ? rel(tPlay) : null, endAt: tEnd ? rel(tEnd) : null, durationSec: rel(Date.now()) }, null, 2));
