/**
 * Week-1 measurement (b): does fal H3 Max speak a line in the persona's voice, per language?
 * Generates a reference voice for en/ko/ja (TTS), then one reaction clip per language with a spoken
 * line and reference_audio_urls, and prints clip URLs + timings. With no FAL_KEY this runs on mocks.
 * Usage: npm run probe:voice -- --langs en,ko,ja
 */
import { loadSettings } from '../config.js';
import { createBackend } from '../backend/index.js';
import { buildPrompt } from '../prompt/builder.js';
import { loadPersona, referenceImageUris, referenceVoiceUri, savePersona, seedTemplates } from '../persona/store.js';
import { VOICE_SAMPLES, generateVoice } from '../persona/voice.js';

const args = process.argv.slice(2);
const langs = (args[args.indexOf('--langs') + 1] || 'en,ko,ja').split(',').filter((l) => l in VOICE_SAMPLES);
const s = { ...loadSettings(), audio: true };
seedTemplates();
const persona = s.personaId ? loadPersona(s.personaId) : null;
if (!persona) throw new Error('no persona');
const backend = createBackend(s.backend);
const images = referenceImageUris(persona);
const LINES: Record<string, string> = { en: "taro, let's do it!", ko: '타로, 해보자!', ja: 'たろうさん、やってみよ！' };
for (const lang of langs) {
  const v = await generateVoice(persona.id, VOICE_SAMPLES[lang], persona.voice?.description, lang);
  persona.references.voices = { ...(persona.references.voices ?? {}), [lang]: v.rel };
  if (!persona.references.voice) persona.references.voice = v.rel;
  savePersona(persona);
  console.log(`[${lang}] voice ${v.rel} via ${v.backend} ($${v.costUsd.toFixed(2)})`);
  const voice = referenceVoiceUri(persona, lang);
  const prompt = buildPrompt({ comment: 'wave and say hi', reply: LINES[lang], refCount: images.length, hasVoice: !!voice }, s, persona);
  const t0 = Date.now();
  try {
    const r = await backend.generate({ prompt, durationSec: s.durationSec, resolution: s.resolution, referenceImageUrls: images, referenceAudioUrl: voice, audio: true }, new AbortController().signal);
    console.log(`[${lang}] clip ${r.clipUrl || r.kind} genMs=${r.genMs} wallMs=${Date.now() - t0} cost=$${r.costUsd.toFixed(2)}`);
    console.log(`[${lang}] listen: does she say "${LINES[lang]}" in the reference voice? (log the answer in docs/REQUIREMENTS.md §8 week 1)`);
  } catch (e) {
    console.log(`[${lang}] FAILED ${(e as Error).message}`);
  }
}
