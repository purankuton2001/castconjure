/** Latency probe: same model, three variants, queue mode with status polling to split queue wait from processing. */
import { falQueue } from '../backend/fal.js';
import { loadSettings, secrets } from '../config.js';
import { loadPersona, referenceImageUris, referenceVoiceUri, seedTemplates } from '../persona/store.js';
import { buildPrompt } from '../prompt/builder.js';

const s = loadSettings(); seedTemplates();
const p = loadPersona(s.personaId)!; const images = referenceImageUris(p); const voice = referenceVoiceUri(p);
const base = { duration: 5, resolution: '480P', prompt_expansion_mode: secrets.falPromptExpansion, enable_safety_checker: true, aspect_ratio: '16:9' };
const action = 'She waves at the camera with both hands, leaning in with a wide smile.';
const variants: { name: string; model: string; input: Record<string, unknown> }[] = [
  { name: 'A r2v, no audio, no spoken line', model: secrets.falR2vModel, input: { ...base, prompt: buildPrompt({ comment: 'wave', action, refCount: 3, hasVoice: false }, { ...s, audio: false }, p), reference_image_urls: images } },
  { name: 'B r2v, reference audio + spoken line', model: secrets.falR2vModel, input: { ...base, prompt: buildPrompt({ comment: 'wave', action, reply: "taro_k, let's do it!", refCount: 3, hasVoice: true }, { ...s, audio: true }, p), reference_image_urls: images, reference_audio_urls: [voice] } },
  { name: 'C t2v, spoken line, no references', model: secrets.falT2vModel, input: { ...base, prompt: buildPrompt({ comment: 'wave', action, reply: "taro_k, let's do it!", refCount: 0, hasVoice: false }, { ...s, audio: true }, p) } },
];
for (const v of variants) {
  const t0 = Date.now();
  let timing: unknown;
  try {
    const out = await falQueue<{ timings?: unknown; video?: { url?: string } }>(v.model, v.input, undefined, secrets.falKey, { sync: false, timing: (t) => (timing = t) });
    console.log(`${v.name}: wall ${((Date.now() - t0) / 1000).toFixed(1)}s`, JSON.stringify(timing), 'fal timings', JSON.stringify(out.timings), out.video?.url);
  } catch (e) { console.log(`${v.name}: FAILED ${(e as Error).message}`); }
}
