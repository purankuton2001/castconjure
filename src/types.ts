/** Shared domain types. Kept domain-agnostic: "comment in, clip out". */

export type Platform = 'youtube' | 'manual';
export type BackendName = 'fal' | 'local' | 'mock';
export type Resolution = '480p' | '768p';

/** A chat message from any platform adapter. */
export interface ChatMessage {
  id: string;
  platform: Platform;
  authorName: string;
  authorId: string;
  text: string;
  /** Epoch millis when the message was published on the platform. */
  publishedAt: number;
  /** Epoch millis when we received it. */
  receivedAt: number;
  isModerator: boolean;
  isOwner: boolean;
}

export interface CharacterSettings {
  name: string;
  description: string;
  /** Things this character must never do / be shown as. */
  forbidden: string;
  /** Local file paths (data/characters/...) or http(s) URLs. Max 3. */
  referenceImages: string[];
}

/** Runtime settings: editable from the config UI, seeded from .env. */
export interface Settings {
  platform: Platform;
  youtubeVideoId: string;
  backend: BackendName;
  resolution: Resolution;
  durationSec: number;
  audio: boolean;
  worldPrompt: string;
  character: CharacterSettings;
  /** Minimum seconds between two generations (global rate limit). */
  minIntervalSec: number;
  /** Seconds a single user must wait before another of their comments is taken. */
  userCooldownSec: number;
  /** If non-empty, only comments starting with this prefix are considered (e.g. "!gen"). */
  commandPrefix: string;
  /** Approval mode: a moderator/owner must approve with `approveCommand` or via the config UI. */
  approvalMode: boolean;
  approveCommand: string;
  /** Extra NG words (streamer-defined). */
  ngWords: string[];
  /** Per-session budget in USD. Reaching it stops generation. */
  budgetUsd: number;
  showAiBadge: boolean;
  maxCommentChars: number;
  /** Max queued (waiting-to-play) clips. Beyond this, new comments are dropped. */
  maxQueue: number;
}

export type FilterReason =
  | 'empty'
  | 'too_long'
  | 'url'
  | 'ng_word'
  | 'real_person'
  | 'no_command_prefix'
  | 'rate_limit'
  | 'user_cooldown'
  | 'queue_full'
  | 'paused'
  | 'budget_exhausted';

export interface GenerateRequest {
  prompt: string;
  durationSec: number;
  resolution: Resolution;
  /** Reference images already resolved to URLs / data URIs. */
  referenceImageUrls: string[];
  audio: boolean;
}

export interface GenerateResult {
  /** Playable URL for the overlay. May be remote (fal CDN) or local (/clips/...). */
  clipUrl: string;
  /** 'video' plays clipUrl in a <video>; 'card' renders text (mock backend). */
  kind: 'video' | 'card';
  genMs: number;
  costUsd: number;
  backend: BackendName;
  expandedPrompt?: string;
  raw?: unknown;
}

export interface GenerateBackend {
  readonly name: BackendName;
  /** Estimated cost before generating, used for the budget guard. */
  estimateCostUsd(req: GenerateRequest): number;
  generate(req: GenerateRequest, signal: AbortSignal): Promise<GenerateResult>;
}

export type JobStatus =
  | 'pending_approval'
  | 'queued'
  | 'generating'
  | 'ready'
  | 'playing'
  | 'done'
  | 'failed'
  | 'rejected';

export interface Job {
  id: string;
  message: ChatMessage;
  prompt: string;
  status: JobStatus;
  createdAt: number;
  approvedAt?: number;
  genStartAt?: number;
  genDoneAt?: number;
  playStartAt?: number;
  playEndAt?: number;
  result?: GenerateResult;
  error?: string;
}

/** Messages sent to the overlay / config UI over WebSocket. */
export type WsServerMessage =
  | { type: 'hello'; settings: Settings; state: PublicState }
  | { type: 'state'; state: PublicState }
  | { type: 'settings'; settings: Settings }
  | { type: 'play'; job: PublicJob }
  | { type: 'generating'; job: PublicJob }
  | { type: 'idle' }
  | { type: 'log'; line: string; level: 'info' | 'warn' | 'error' };

export interface PublicJob {
  id: string;
  authorName: string;
  text: string;
  prompt: string;
  status: JobStatus;
  clipUrl?: string;
  kind?: 'video' | 'card';
  durationSec: number;
  showAiBadge: boolean;
}

export interface PublicState {
  running: boolean;
  paused: boolean;
  chatConnected: boolean;
  chatInfo: string;
  spentUsd: number;
  budgetUsd: number;
  budgetExhausted: boolean;
  pending: PublicJob[];
  queue: PublicJob[];
  current?: PublicJob;
  recent: PublicJob[];
  stats: { received: number; filtered: number; generated: number; failed: number; played: number };
  youtube?: { polls: number; estUnits: number; lastIntervalMs: number };
}
