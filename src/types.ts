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

/** A persona ("推し"): the generated character that fronts the stream. Lives in data/personas/<id>/. */
export type PersonaStyle = 'photoreal' | 'anime';

export interface Persona {
  id: string;
  name: string;
  /** Visual style preset. Drives the face-gacha suffix and the video prompt. Default photoreal. */
  style?: PersonaStyle;
  /** Fixed generation seed: same seed + same voice/appearance description keeps face and voice stable across clips. */
  seed?: number;
  reading?: string;
  nameEn?: string;
  age?: number;
  adult: boolean;
  fanName?: string;
  catchphrase?: string;
  appearance: { summary: string; signatures?: string[]; defaultOutfit?: string; defaultScene?: string };
  /** Files relative to the persona dir. Only ever produced in-app (F-10/F-11); never a photo of a real person. */
  references: {
    face?: string;
    full?: string;
    scene?: string;
    /** 16:9 first-frame image for i2v modes (a frame of the idle pool), refs/frame.png */
    frame?: string;
    /** Primary reference voice (the persona's default language). */
    voice?: string;
    /** Per-language reference voices (F-11 multilingual), e.g. { en: 'voice.en.mp3', ko: 'voice.ko.mp3' }. */
    voices?: Record<string, string>;
    confirmed?: boolean;
    note?: string;
  };
  referencePrompts?: { suffix?: string; face?: string; full?: string; scene?: string };
  worldPrompt?: string;
  personality: {
    principle?: string;
    tone?: string;
    verbalTics?: string[];
    likes?: string[];
    dislikes?: string[];
    origin?: string;
    distance?: string;
    replyMaxChars?: number;
  };
  forbidden: string[];
  voice?: { description?: string; sampleLine?: string; /** fal MiniMax cloned voice id (from the H3-generated reference) */ customVoiceId?: string; /** where the reference came from: h3 | tts */ source?: 'h3' | 'tts' };
  replySystemPrompt?: string;
  idle?: { clips: IdleClip[]; prompts?: string[] };
  /** Pre-generated "noticed your comment" clips (5 s, spoken): played instantly while the reaction generates. */
  ack?: { clips: IdleClip[] };
}

export interface IdleClip {
  /** File relative to persona dir (idle/01.mp4) or empty for card. */
  file: string;
  kind: 'video' | 'card';
  prompt: string;
  costUsd: number;
}

/** Runtime settings: editable from the config UI, seeded from .env. */
export interface Settings {
  platform: Platform;
  youtubeVideoId: string;
  backend: BackendName;
  resolution: Resolution;
  durationSec: number;
  audio: boolean;
  /** Per-stream world prompt. Empty = use the persona's default. */
  worldPrompt: string;
  personaId: string;
  /** Reply mode (F-14): an LLM answers in the persona's voice; the line goes into the prompt and the subtitle. */
  replyMode: boolean;
  /** Idle pool size to generate (F-13). */
  idlePoolSize: number;
  /** Show the reply subtitle before the clip (spoils the reaction; off by default). */
  instantReply: boolean;
  /** Bridge the wait with a pre-generated "noticed your comment" clip from the persona's ack pool. */
  ackClips: boolean;
  /** Which reference images to send (speed vs consistency): face ≈ 9 s, face+scene ≈ 10 s, all three ≈ 13 s with voice. */
  refMode: 'face' | 'face+scene' | 'all';
  /** Send the reference voice (voice consistency, ≈ +6 s). Off = H3 picks a voice per clip. */
  voiceRef: boolean;
  /**
   * How reaction clips are generated:
   *  r2v        reference-to-video: 1–3 reference images (+ voice) — best consistency, ≈ 9–13 s
   *  i2v        image-to-video from a frame of the idle pool — seamless start, ≈ 3–4 s, no reference voice
   *  i2v-turbo  same with H3 Max Turbo — fastest, ≈ 3–5 s
   */
  genMode: 'r2v' | 'i2v' | 'i2v-turbo';
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
  | 'ip'
  | 'no_command_prefix'
  | 'command'
  | 'rate_limit'
  | 'user_cooldown'
  | 'queue_full'
  | 'paused'
  | 'budget_exhausted';

export interface GenerateRequest {
  prompt: string;
  durationSec: number;
  resolution: Resolution;
  /** Reference images already resolved to URLs / data URIs (face, full, scene). */
  referenceImageUrls: string[];
  /** Reference voice (data URI / URL), passed as reference_audio_urls when audio is on. */
  referenceAudioUrl?: string;
  /** First frame (data URI / URL) for image-to-video modes. */
  firstFrameUrl?: string;
  /** Generation mode override (defaults to r2v when reference images are present). */
  mode?: 'r2v' | 'i2v' | 'i2v-turbo';
  /** Fixed seed (persona.seed) for consistency. */
  seed?: number;
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
  /** Reply line from the LLM (reply mode). */
  reply?: string;
  replyMs?: number;
  /** Concrete action the clip should show (from the reply step or the keyword director). */
  action?: string;
  /** TTS of the reply line for the instant acknowledgement (/clips/<job>.reply.mp3). */
  ackVoiceUrl?: string;
  /** Same-origin URL for the clip (/clips/<job>.mp4), proxied from the CDN until cached. */
  localUrl?: string;
  /** Acknowledgement clip (from the persona's ack pool) that bridges the wait for this job's reaction. */
  isAck?: boolean;
  /** For an ack job: the id of the reaction job it bridges. */
  forJob?: string;
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
  | { type: 'ack'; job: PublicJob }
  | { type: 'idle' }
  | { type: 'idlePool'; persona: { id: string; name: string; fanName?: string }; clips: { url: string; kind: 'video' | 'card' }[] }
  | { type: 'persona'; persona: Persona | null }
  | { type: 'log'; line: string; level: 'info' | 'warn' | 'error' };

export interface PublicJob {
  id: string;
  authorName: string;
  text: string;
  prompt: string;
  reply?: string;
  action?: string;
  ackVoiceUrl?: string;
  isAck?: boolean;
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
  persona?: { id: string; name: string; refs: number; voice: boolean; idleClips: number; ackClips: number; confirmed: boolean };
  idleJob?: { running: boolean; done: number; total: number };
}
