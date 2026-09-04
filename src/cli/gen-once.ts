/**
 * Week-1 smoke test: generate ONE clip from a prompt with the configured backend and print
 * the URL + timings. Usage: npm run gen:once -- "a cat surfing on a rainbow"
 */
import { loadSettings } from '../config.js';
import { createBackend, resolveReferenceImages } from '../backend/index.js';
import { buildPrompt } from '../prompt/builder.js';

const comment = process.argv.slice(2).join(' ') || 'a tiny dragon sneezes and accidentally lights a birthday candle';
const s = loadSettings();
const backend = createBackend(s.backend);
const refs = resolveReferenceImages(s.character.referenceImages);
const prompt = buildPrompt(comment, s, refs.length > 0);
const req = { prompt, durationSec: s.durationSec, resolution: s.resolution, referenceImageUrls: refs, audio: s.audio };
console.log(`backend=${backend.name} resolution=${s.resolution} duration=${s.durationSec}s refs=${refs.length} estimate=$${backend.estimateCostUsd(req).toFixed(3)}`);
console.log('--- prompt ---\n' + prompt + '\n--------------');
const t0 = Date.now();
const r = await backend.generate(req, new AbortController().signal);
console.log(JSON.stringify({ clipUrl: r.clipUrl, kind: r.kind, genMs: r.genMs, wallMs: Date.now() - t0, costUsd: r.costUsd, expandedPrompt: r.expandedPrompt, raw: r.raw }, null, 2));
