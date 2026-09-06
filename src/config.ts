import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from './types.js';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CLIPS_DIR = path.join(DATA_DIR, 'clips');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');
export const PERSONAS_DIR = path.join(DATA_DIR, 'personas');
export const PERSONA_TEMPLATES_DIR = path.join(ROOT, 'personas');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const env = (k: string, d = ''): string => (process.env[k] ?? d).trim();
const envNum = (k: string, d: number): number => {
  const v = Number(env(k));
  return Number.isFinite(v) && env(k) !== '' ? v : d;
};
const envBool = (k: string, d: boolean): boolean => {
  const v = env(k).toLowerCase();
  if (v === '') return d;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

/** Secrets and process-level config. Never sent to clients. */
export const secrets = {
  falKey: env('FAL_KEY'),
  youtubeApiKey: env('YOUTUBE_API_KEY'),
  port: envNum('PORT', 8787),
  falT2vModel: env('FAL_T2V_MODEL', 'minimax/h3-max/text-to-video'),
  falI2vModel: env('FAL_I2V_MODEL', 'minimax/h3-max/image-to-video'),
  falR2vModel: env('FAL_R2V_MODEL', 'minimax/h3-max/reference-to-video'),
  falI2vTurboModel: env('FAL_I2V_TURBO_MODEL', 'minimax/h3-max-turbo/image-to-video'),
  falPromptExpansion: env('FAL_PROMPT_EXPANSION', 'balanced'),
  /** Cache generated clips locally so OBS never hits an expired CDN URL (done in the background; playback starts from the CDN URL). */
  cacheClips: envBool('CACHE_CLIPS', true),
  /** Synchronous fal.run endpoint. Measured 7–10 s slower than the queue for H3 Max; off by default. */
  falSync: envBool('FAL_SYNC', false),
  comfyUrl: env('COMFY_URL', 'http://127.0.0.1:8188'),
  comfyWorkflow: env('COMFY_WORKFLOW', path.join(ROOT, 'local', 'workflow.json')),
  youtubeUnitsPerPoll: envNum('YOUTUBE_UNITS_PER_POLL', 5),
  youtubeMinPollMs: envNum('YOUTUBE_MIN_POLL_MS', 0),
  maxConcurrentGen: envNum('MAX_CONCURRENT_GEN', 1),
  genTimeoutMs: envNum('GEN_TIMEOUT_MS', 120_000),
  /** F-10 face gacha: text-to-image and reference-edit models on fal. */
  falImageModel: env('FAL_IMAGE_MODEL', 'fal-ai/flux/dev'),
  falImageEditModel: env('FAL_IMAGE_EDIT_MODEL', 'fal-ai/flux-pro/kontext'),
  /** F-11 voice: TTS model on fal + extra JSON merged into the request. */
  falTtsModel: env('FAL_TTS_MODEL', 'fal-ai/minimax/speech-02-hd'),
  falTtsExtra: env('FAL_TTS_EXTRA', '{}'),
  /** F-14 reply mode: mock | anthropic | gemini | openai (BYOK). */
  replyProvider: env('REPLY_PROVIDER', 'mock'),
  replyModel: env('REPLY_MODEL'),
  anthropicKey: env('ANTHROPIC_API_KEY'),
  geminiKey: env('GEMINI_API_KEY') || env('GOOGLE_GENERATIVE_AI_API_KEY'),
  openaiKey: env('OPENAI_API_KEY'),
  /** Image generation is mock unless FAL_KEY is set and PERSONA_IMAGES=fal. */
  personaImages: env('PERSONA_IMAGES', 'auto'),
};

/** Image / TTS unit prices (USD), rough fal list prices 2026-09; override via env. */
export const personaPricing = {
  imagePerCall: envNum('PRICE_IMAGE', 0.03),
  imageEditPerCall: envNum('PRICE_IMAGE_EDIT', 0.04),
  ttsPerCall: envNum('PRICE_TTS', 0.02),
};

/** fal pricing (USD per second of output), confirmed 2026-09. Override via env if fal changes it. */
export const pricing = {
  t2v480: envNum('PRICE_T2V_480P', 0.05),
  t2v768: envNum('PRICE_T2V_768P', 0.08),
  r2vPerSec: envNum('PRICE_R2V_PER_SEC', 0.08),
  r2vPerImage: envNum('PRICE_R2V_PER_IMAGE', 0.02),
  /** H3 Max Turbo per-second price (fal page does not list it; assumed equal to H3 Max until verified on the invoice) */
  turbo480: envNum('PRICE_TURBO_480P', 0.05),
  turbo768: envNum('PRICE_TURBO_768P', 0.08),
};

export function defaultSettings(): Settings {
  return {
    platform: (env('PLATFORM', 'manual') as Settings['platform']) || 'manual',
    youtubeVideoId: env('YOUTUBE_VIDEO_ID'),
    backend: (env('BACKEND', 'mock') as Settings['backend']) || 'mock',
    resolution: (env('RESOLUTION', '480p') as Settings['resolution']) || '480p',
    durationSec: envNum('DURATION_SEC', 5),
    audio: envBool('AUDIO', false),
    worldPrompt: env('WORLD_PROMPT'),
    personaId: env('PERSONA_ID', 'shirotsume-yui'),
    replyMode: envBool('REPLY_MODE', false),
    idlePoolSize: envNum('IDLE_POOL_SIZE', 12),
    instantReply: envBool('INSTANT_REPLY', false),
    ackClips: envBool('ACK_CLIPS', true),
    refMode: (env('REF_MODE', 'face+scene') as Settings['refMode']) || 'face+scene',
    voiceRef: envBool('VOICE_REF', true),
    genMode: (env('GEN_MODE', 'i2v-turbo') as Settings['genMode']) || 'i2v-turbo',
    minIntervalSec: envNum('MIN_INTERVAL_SEC', 30),
    userCooldownSec: envNum('USER_COOLDOWN_SEC', 120),
    commandPrefix: env('COMMAND_PREFIX', ''),
    approvalMode: envBool('APPROVAL_MODE', false),
    approveCommand: env('APPROVE_COMMAND', '!ok'),
    ngWords: env('NG_WORDS').split(',').map((w) => w.trim()).filter(Boolean),
    budgetUsd: envNum('BUDGET_USD', 20),
    showAiBadge: envBool('SHOW_AI_BADGE', true),
    maxCommentChars: envNum('MAX_COMMENT_CHARS', 120),
    maxQueue: envNum('MAX_QUEUE', 5),
  };
}

/** Settings persist to data/settings.json so a restart mid-stream keeps the streamer's setup. */
export function loadSettings(): Settings {
  const base = defaultSettings();
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<Settings>;
    return sanitizeSettings({ ...base, ...raw });
  } catch {
    return base;
  }
}

export function saveSettings(s: Settings): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

const clamp = (n: unknown, lo: number, hi: number, d: number): number => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
};

export function sanitizeSettings(s: Settings): Settings {
  return {
    ...s,
    platform: s.platform === 'youtube' ? 'youtube' : 'manual',
    backend: ['fal', 'local', 'mock'].includes(s.backend) ? s.backend : 'mock',
    resolution: s.resolution === '768p' ? '768p' : '480p',
    durationSec: clamp(s.durationSec, 5, 10, 5),
    minIntervalSec: clamp(s.minIntervalSec, 0, 3600, 30),
    userCooldownSec: clamp(s.userCooldownSec, 0, 86400, 120),
    budgetUsd: clamp(s.budgetUsd, 0, 100000, 20),
    maxCommentChars: clamp(s.maxCommentChars, 10, 500, 120),
    maxQueue: clamp(s.maxQueue, 1, 50, 5),
    commandPrefix: String(s.commandPrefix ?? '').trim(),
    approveCommand: String(s.approveCommand ?? '!ok').trim() || '!ok',
    ngWords: Array.isArray(s.ngWords) ? s.ngWords.map(String).map((w) => w.trim()).filter(Boolean) : [],
    worldPrompt: String(s.worldPrompt ?? ''),
    personaId: String(s.personaId ?? '').replace(/[^a-z0-9_-]/gi, ''),
    replyMode: !!s.replyMode,
    idlePoolSize: clamp(s.idlePoolSize, 1, 60, 12),
    instantReply: s.instantReply === true,
    ackClips: s.ackClips !== false,
    refMode: (['face', 'face+scene', 'all'] as const).includes(s.refMode) ? s.refMode : 'face+scene',
    voiceRef: s.voiceRef !== false,
    genMode: (['r2v', 'i2v', 'i2v-turbo'] as const).includes(s.genMode) ? s.genMode : 'i2v-turbo',
  };
}
