// H3 Max Director probe: opens a continuous WebRTC session in headless Chrome, updates the prompt on a schedule,
// records audio+video (MediaRecorder in-page) and logs every server message with timestamps.
// Usage: node scripts/director-probe.mjs --seconds 120 --out out/director [--resolution 480p] [--memory 12]
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import 'dotenv/config';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : []).filter(Boolean));
const seconds = Number(args.seconds || 120);
const out = resolve(args.out || 'out/director');
const key = process.env.FAL_KEY;
if (!key) throw new Error('FAL_KEY missing');
mkdirSync(out, { recursive: true });
// bundle the browser module (fal client + realtime) with esbuild (a dependency of tsx)
const bundle = resolve(out, 'director.bundle.js');
execFileSync(resolve('node_modules/.bin/esbuild'), [resolve('scripts/director-page.mjs'), '--bundle', '--format=esm', '--platform=browser', `--outfile=${bundle}`], { stdio: 'inherit' });

const persona = JSON.parse(readFileSync('data/personas/shirotsume-yui/persona.json', 'utf8'));
const framePath = 'data/personas/shirotsume-yui/refs/frame.png';
const imageDataUrl = existsSync(framePath) ? 'data:image/png;base64,' + readFileSync(framePath).toString('base64') : null;

const base = `${persona.appearance?.summary || ''} ${(persona.appearance?.signatures || []).join(', ')}. Photorealistic, natural skin, soft daylight, the same young woman as the first frame, fictional adult not resembling any real idol or existing character. Her voice: ${persona.voice?.description || 'a warm, clear young female voice'}. Continuous single take, camera fixed, eye-level.`;
const prompts = [
  { at: 0, text: `${base} She sits at her desk facing the camera like a livestream, idle and relaxed: small natural movements, glances at the chat, smiles, adjusts her hair. She says, in English: "Hi everyone, welcome to the stream!"` },
  { at: 30, text: `${base} She springs up and dances energetically to an upbeat rhythm, spinning once, hair flying, whole body. She says, in English: "Okay, you asked for it, here I go!"` },
  { at: 60, text: `${base} She stops dancing, waves at the camera with both hands and laughs, slightly out of breath. She says, in Japanese: "みんな見てくれてありがとう！"` },
  { at: 90, text: `${base} She sits back down, picks up a mug, takes a sip and relaxes, looking at the chat with a calm smile. She says, in Korean: "다들 고마워요, 다음 댓글 기다릴게요."` },
];

const events = [];
const t0 = Date.now();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] });
const page = await browser.newPage({ viewport: { width: 854, height: 480 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') events.push({ t: Date.now() - t0, ev: 'console', text: m.text().slice(0, 300) }); });
await page.exposeFunction('__log', (s) => { const o = JSON.parse(s); o.rel = ((o.t - t0) / 1000).toFixed(2); events.push(o); const short = o.ev === 'msg' ? `${o.m?.type} ${JSON.stringify(o.m).slice(0, 220)}` : JSON.stringify({ ...o, t: undefined }).slice(0, 220); console.log(`[${o.rel}s] ${o.ev} ${short}`); });
await page.setContent('<!doctype html><body style="margin:0;background:#000"><video autoplay playsinline muted style="width:854px;height:480px;object-fit:contain"></video></body>');
await page.addScriptTag({ content: readFileSync(bundle, 'utf8'), type: 'module' });
await page.waitForFunction(() => typeof window.directorRun === 'function');

const info = await page.evaluate((cfg) => window.directorRun(cfg), {
  key, endpoint: args.endpoint || 'minimax/h3-max/director', imageDataUrl, seed: persona.seed ?? 20260905,
  resolution: args.resolution || '480p', memory: Number(args.memory || 12), prompt: prompts[0].text,
});
console.log('configured; image_url =', info.imageUrl);

for (const p of prompts.slice(1)) {
  const wait = p.at * 1000 - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await page.evaluate(({ text, v }) => window.directorSend({ type: 'prompt', prompt: text, prompt_version: v }), { text: p.text, v: prompts.indexOf(p) + 1 });
  await page.screenshot({ path: `${out}/at-${p.at}s.png` });
}
const remain = seconds * 1000 - (Date.now() - t0);
if (remain > 0) await new Promise((r) => setTimeout(r, remain));
await page.screenshot({ path: `${out}/at-end.png` });
const b64 = await page.evaluate(() => window.directorStop());
writeFileSync(`${out}/session.webm`, Buffer.from(b64, 'base64'));
writeFileSync(`${out}/events.json`, JSON.stringify({ t0, prompts, events }, null, 1));
console.log(`saved ${out}/session.webm (${(b64.length * 0.75 / 1e6).toFixed(1)} MB), ${events.length} events`);
await browser.close();
