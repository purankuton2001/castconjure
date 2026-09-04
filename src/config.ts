import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from './types.js';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const CLIPS_DIR = path.join(DATA_DIR, 'clips');
export const LOGS_DIR = path.join(DATA_DIR, 'logs');
export const CHARACTERS_DIR = path.join(DATA_DIR, 'characters');
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
const envList = (k: string): string[] =>
  env(k)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Secrets and process-level config. Never sent to clients. */
export const secrets = {
  falKey: env('FAL_KEY'),
  youtubeApiKey: env('YOUTUBE_API_KEY'),
  port: envNum('PORT', 8787),
  falT2vModel: env('FAL_T2V_MODEL', 'minimax/h3-max/text-to-video'),
  falI2vModel: env('FAL_I2V_MODEL', 'minimax/h3-max/image-to-video'),
  falR2vModel: env('FAL_R2V_MODEL', 'minimax/h3-max/reference-to-video'),
  falPromptExpansion: env('FAL_PROMPT_EXPANSION', 'balanced'),
  /** Cache generated clips locally so OBS never hits an expired CDN URL. */
  cacheClips: envBool('CACHE_CLIPS', true),
  comfyUrl: env('COMFY_URL', 'http://127.0.0.1:8188'),
  comfyWorkflow: env('COMFY_WORKFLOW', path.join(ROOT, 'local', 'workflow.json')),
  youtubeUnitsPerPoll: envNum('YOUTUBE_UNITS_PER_POLL', 5),
  youtubeMinPollMs: envNum('YOUTUBE_MIN_POLL_MS', 0),
  maxConcurrentGen: envNum('MAX_CONCURRENT_GEN', 1),
  genTimeoutMs: envNum('GEN_TIMEOUT_MS', 120_000),
};

/** fal pricing (USD per second of output), confirmed 2026-09. Override via env if fal changes it. */
export const pricing = {
  t2v480: envNum('PRICE_T2V_480P', 0.05),
  t2v768: envNum('PRICE_T2V_768P', 0.08),
  r2vPerSec: envNum('PRICE_R2V_PER_SEC', 0.08),
  r2vPerImage: envNum('PRICE_R2V_PER_IMAGE', 0.02),
};

export function defaultSettings(): Settings {
  return {
    platform: (env('PLATFORM', 'manual') as Settings['platform']) || 'manual',
    youtubeVideoId: env('YOUTUBE_VIDEO_ID'),
    backend: (env('BACKEND', 'mock') as Settings['backend']) || 'mock',
    resolution: (env('RESOLUTION', '480p') as Settings['resolution']) || '480p',
    durationSec: envNum('DURATION_SEC', 5),
    audio: envBool('AUDIO', false),
    worldPrompt: env(
      'WORLD_PROMPT',
      'A whimsical, colorful animated world. Cinematic lighting, smooth motion, no text on screen.',
    ),
    character: {
      name: env('CHARACTER_NAME'),
      description: env('CHARACTER_DESCRIPTION'),
      forbidden: env('CHARACTER_FORBIDDEN'),
      referenceImages: envList('CHARACTER_REFERENCE_IMAGES').slice(0, 3),
    },
    minIntervalSec: envNum('MIN_INTERVAL_SEC', 30),
    userCooldownSec: envNum('USER_COOLDOWN_SEC', 120),
    commandPrefix: env('COMMAND_PREFIX', ''),
    approvalMode: envBool('APPROVAL_MODE', false),
    approveCommand: env('APPROVE_COMMAND', '!ok'),
    ngWords: envList('NG_WORDS'),
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
    return sanitizeSettings({ ...base, ...raw, character: { ...base.character, ...(raw.character ?? {}) } });
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
    character: {
      name: String(s.character?.name ?? ''),
      description: String(s.character?.description ?? ''),
      forbidden: String(s.character?.forbidden ?? ''),
      referenceImages: (Array.isArray(s.character?.referenceImages) ? s.character.referenceImages : [])
        .map(String)
        .filter(Boolean)
        .slice(0, 3),
    },
  };
}
