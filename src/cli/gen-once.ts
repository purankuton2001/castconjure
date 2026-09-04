/**
 * Smoke test: generate ONE reaction clip for the active persona and print URL + timings.
 * Usage: npm run gen:once -- "猫がサーフィンしてる"
 */
import { loadSettings } from '../config.js';
import { createBackend } from '../backend/index.js';
import { buildPrompt } from '../prompt/builder.js';
import { loadPersona, referenceImageUris, referenceVoiceUri, seedTemplates } from '../persona/store.js';

const comment = process.argv.slice(2).join(' ') || 'a tiny dragon sneezes and lights a birthday candle';
const s = loadSettings();
seedTemplates();
const persona = s.personaId ? loadPersona(s.personaId) : null;
const backend = createBackend(s.backend);
const images = persona ? referenceImageUris(persona) : [];
const voice = persona ? referenceVoiceUri(persona) : undefined;
const prompt = buildPrompt({ comment, refCount: images.length, hasVoice: !!voice }, s, persona);
const req = { prompt, durationSec: s.durationSec, resolution: s.resolution, referenceImageUrls: images, referenceAudioUrl: voice, audio: s.audio };
console.log(`backend=${backend.name} persona=${persona?.id ?? '-'} refs=${images.length} voice=${!!voice} resolution=${s.resolution} duration=${s.durationSec}s estimate=$${backend.estimateCostUsd(req).toFixed(3)}`);
console.log('--- prompt ---\n' + prompt + '\n--------------');
const t0 = Date.now();
const r = await backend.generate(req, new AbortController().signal);
console.log(JSON.stringify({ clipUrl: r.clipUrl, kind: r.kind, genMs: r.genMs, wallMs: Date.now() - t0, costUsd: r.costUsd, expandedPrompt: r.expandedPrompt, raw: r.raw }, null, 2));
