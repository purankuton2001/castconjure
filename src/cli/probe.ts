/**
 * Week-1 measurement (§8): generate N reaction clips for the active persona, log each to JSONL,
 * and write an HTML contact sheet (data/logs/probe-<stamp>.html) for subjective consistency rating.
 * Usage: npm run probe -- --n 20 --comment "手を振って"
 */
import fs from 'node:fs';
import path from 'node:path';
import { LOGS_DIR, loadSettings } from '../config.js';
import { createBackend } from '../backend/index.js';
import { buildPrompt } from '../prompt/builder.js';
import { loadPersona, referenceImageUris, referenceVoiceUri, seedTemplates } from '../persona/store.js';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const n = Number(opt('n', '5'));
const comments = opt('comment', '手を振って|笑って|マグカップでお茶を飲んで|髪を直して|びっくりして').split('|');
const s = loadSettings();
seedTemplates();
const persona = s.personaId ? loadPersona(s.personaId) : null;
if (!persona) throw new Error('no persona');
const backend = createBackend(s.backend);
const images = referenceImageUris(persona);
const voice = referenceVoiceUri(persona);
fs.mkdirSync(LOGS_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonl = path.join(LOGS_DIR, `probe-${stamp}.jsonl`);
const rows: { i: number; comment: string; url: string; genMs: number; costUsd: number }[] = [];
console.log(`probe: persona=${persona.id} refs=${images.length} backend=${backend.name} n=${n} est=$${(backend.estimateCostUsd({ prompt: '', durationSec: s.durationSec, resolution: s.resolution, referenceImageUrls: images, audio: false }) * n).toFixed(2)}`);
for (let i = 0; i < n; i++) {
  const comment = comments[i % comments.length];
  const prompt = buildPrompt({ comment, refCount: images.length, hasVoice: !!voice }, s, persona);
  const t0 = Date.now();
  try {
    const r = await backend.generate({ prompt, durationSec: s.durationSec, resolution: s.resolution, referenceImageUrls: images, referenceAudioUrl: voice, audio: s.audio }, new AbortController().signal);
    rows.push({ i, comment, url: r.clipUrl, genMs: r.genMs, costUsd: r.costUsd });
    fs.appendFileSync(jsonl, JSON.stringify({ t: Date.now(), ev: 'probe_clip', i, comment, url: r.clipUrl, genMs: r.genMs, costUsd: r.costUsd, kind: r.kind }) + '\n');
    console.log(`${i + 1}/${n} ${(r.genMs / 1000).toFixed(1)}s ${r.clipUrl}`);
  } catch (e) {
    fs.appendFileSync(jsonl, JSON.stringify({ t: Date.now(), ev: 'probe_failed', i, comment, error: (e as Error).message, ms: Date.now() - t0 }) + '\n');
    console.log(`${i + 1}/${n} FAILED ${(e as Error).message}`);
  }
}
const html = `<!doctype html><meta charset="utf-8"><title>probe ${stamp}</title>
<style>body{font-family:system-ui;background:#111;color:#eee;padding:20px}div.g{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}figure{margin:0}video{width:100%}figcaption{font-size:12px;color:#aaa}</style>
<h1>${persona.name} — ${rows.length} clips, refs=${images.length}, backend=${backend.name}</h1>
<p>顔一貫性を 1〜5 で主観評価し、平均 4 以上なら参照 3 枚で成立（§5）。</p>
<div class="g">${rows.map((r) => `<figure><video src="${r.url}" controls muted loop></video><figcaption>#${r.i + 1} ${r.comment} · ${(r.genMs / 1000).toFixed(1)}s · $${r.costUsd.toFixed(2)}</figcaption></figure>`).join('')}</div>`;
const out = path.join(LOGS_DIR, `probe-${stamp}.html`);
fs.writeFileSync(out, html);
console.log(`wrote ${jsonl}\nwrote ${out}`);
