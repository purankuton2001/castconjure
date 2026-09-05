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

export async function generateVoice(personaId: string, text: string, description?: string, lang = 'ja'): Promise<{ rel: string; costUsd: number; backend: 'fal' | 'mock' }> {
  const dir = personaDir(personaId);
  fs.mkdirSync(dir, { recursive: true });
  const useFal = secrets.personaImages === 'fal' || (secrets.personaImages === 'auto' && !!secrets.falKey);
  if (!useFal) {
    const rel = `voice.${lang}.wav`;
    fs.writeFileSync(path.join(dir, rel), mockVoiceWav());
    return { rel, costUsd: 0, backend: 'mock' };
  }
  let extra: Record<string, unknown> = {};
  try {
    extra = JSON.parse(secrets.falTtsExtra) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  const out = await falQueue<Record<string, unknown>>(secrets.falTtsModel, { text, ...(description ? { voice_description: description } : {}), ...extra });
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
