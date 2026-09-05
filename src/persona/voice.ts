import fs from 'node:fs';
import path from 'node:path';
import { personaPricing, secrets } from '../config.js';
import { falQueue } from '../backend/fal.js';
import { mockVoiceWav } from '../util/wav.js';
import { personaDir } from './store.js';

/**
 * F-11 voice. The persona's reference voice is always TTS-generated (never cloned from a real person).
 * fal TTS models differ in schema; FAL_TTS_EXTRA (JSON) is merged into the request, and the first
 * audio URL found in the response is used.
 */
export const VOICE_SAMPLES: Record<string, string> = {
  en: "Hey! Thanks for coming. Say it in chat and I'll try it — if it goes wrong, we laugh.",
  ko: '안녕! 와줘서 고마워. 채팅에 적어주면 해볼게. 안 되면 같이 웃자.',
  ja: 'えー、待って、ほんとに？ じゃあやってみよ！ うまくいかなかったら笑って。',
};

/** Language of a line by script: Hangul → ko, kana/kanji → ja, else en. Used to pick the reference voice. */
export function detectLang(text: string): 'en' | 'ko' | 'ja' {
  if (/[\uac00-\ud7a3]/.test(text)) return 'ko';
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) return 'ja';
  return 'en';
}

function ttsInput(text: string, description?: string, voiceId?: string): Record<string, unknown> {
  let extra: Record<string, unknown> = {};
  try {
    extra = JSON.parse(secrets.falTtsExtra) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const input: Record<string, unknown> = { text, ...(description && !voiceId ? { voice_description: description } : {}), ...extra };
  if (voiceId) input.voice_setting = { ...((extra.voice_setting as Record<string, unknown>) ?? {}), voice_id: voiceId };
  return input;
}

/** Clone a voice from a ≥10 s sample (data URI / URL) → fal MiniMax custom_voice_id. */
export async function cloneVoice(audioUrl: string, previewText?: string): Promise<{ voiceId: string; previewUrl?: string }> {
  const out = await falQueue<{ custom_voice_id?: string; audio?: { url?: string } }>('fal-ai/minimax/voice-clone', { audio_url: audioUrl, noise_reduction: true, need_volume_normalization: true, ...(previewText ? { text: previewText } : {}) }, undefined, secrets.falKey, { sync: true });
  if (!out.custom_voice_id) throw new Error(`voice-clone returned no custom_voice_id: ${JSON.stringify(out).slice(0, 200)}`);
  return { voiceId: out.custom_voice_id, previewUrl: out.audio?.url };
}

export async function generateVoice(personaId: string, text: string, description?: string, lang = 'ja', voiceId?: string): Promise<{ rel: string; costUsd: number; backend: 'fal' | 'mock' }> {
  const dir = personaDir(personaId);
  fs.mkdirSync(dir, { recursive: true });
  const useFal = secrets.personaImages === 'fal' || (secrets.personaImages === 'auto' && !!secrets.falKey);
  if (!useFal) {
    const rel = `voice.${lang}.wav`;
    fs.writeFileSync(path.join(dir, rel), mockVoiceWav());
    return { rel, costUsd: 0, backend: 'mock' };
  }
  const out = await falQueue<Record<string, unknown>>(secrets.falTtsModel, ttsInput(text, description, voiceId));
  const url = findAudioUrl(out);
  if (!url) throw new Error(`TTS returned no audio url: ${JSON.stringify(out).slice(0, 200)}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`voice download ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  const ext = ct.includes('wav') ? 'wav' : ct.includes('mpeg') || url.endsWith('.mp3') ? 'mp3' : 'wav';
  const rel = `voice.${lang}.${ext}`;
  fs.writeFileSync(path.join(dir, rel), Buffer.from(await res.arrayBuffer()));
  return { rel, costUsd: personaPricing.ttsPerCall, backend: 'fal' };
}

function findAudioUrl(o: unknown): string | undefined {
  if (!o || typeof o !== 'object') return undefined;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v) && (k === 'url' || k.endsWith('_url') || /\.(mp3|wav|ogg)(\?|$)/.test(v))) return v;
    const nested = findAudioUrl(v);
    if (nested) return nested;
  }
  return undefined;
}

/** TTS of one line to a file (instant acknowledgement). Returns null on mock / no key. */
export async function ttsToFile(text: string, outPath: string, description?: string, voiceId?: string): Promise<{ costUsd: number } | null> {
  const useFal = secrets.personaImages === 'fal' || (secrets.personaImages === 'auto' && !!secrets.falKey);
  if (!useFal) return null;
  const out = await falQueue<Record<string, unknown>>(secrets.falTtsModel, ttsInput(text, description, voiceId), undefined, secrets.falKey, { sync: true });
  const url = findAudioUrl(out);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  return { costUsd: personaPricing.ttsPerCall };
}
