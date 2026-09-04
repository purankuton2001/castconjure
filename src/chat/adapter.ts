import type { ChatMessage } from '../types.js';

export interface ChatAdapterEvents {
  onMessage: (msg: ChatMessage) => void;
  onStatus: (connected: boolean, info: string) => void;
  onLog: (level: 'info' | 'warn' | 'error', line: string) => void;
}

/** Platform adapter. Implementations: YouTube Live (API key polling), manual (HTTP injection). */
export interface ChatAdapter {
  readonly platform: string;
  start(events: ChatAdapterEvents): Promise<void>;
  stop(): Promise<void>;
  /** Optional platform-specific stats for the config UI / metrics. */
  stats?(): Record<string, number>;
}
