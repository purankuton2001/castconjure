import type { ChatAdapter, ChatAdapterEvents } from './adapter.js';
import type { ChatMessage } from '../types.js';

/**
 * Manual adapter: comments are injected via POST /api/comment (config UI "test comment").
 * Used for development and for streamers who want to curate by hand.
 */
export class ManualAdapter implements ChatAdapter {
  readonly platform = 'manual';
  private events?: ChatAdapterEvents;
  private seq = 0;

  async start(events: ChatAdapterEvents): Promise<void> {
    this.events = events;
    events.onStatus(true, 'manual: inject comments from the config UI');
  }

  async stop(): Promise<void> {
    this.events?.onStatus(false, 'stopped');
    this.events = undefined;
  }

  inject(text: string, authorName = 'tester', opts: { isOwner?: boolean; isModerator?: boolean } = {}): ChatMessage | null {
    if (!this.events) return null;
    const now = Date.now();
    const msg: ChatMessage = {
      id: `manual-${now}-${++this.seq}`,
      platform: 'manual',
      authorName,
      authorId: `manual:${authorName}`,
      text,
      publishedAt: now,
      receivedAt: now,
      isModerator: !!opts.isModerator,
      isOwner: !!opts.isOwner,
    };
    this.events.onMessage(msg);
    return msg;
  }
}
