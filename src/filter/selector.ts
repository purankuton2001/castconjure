import type { ChatMessage, FilterReason, Settings } from '../types.js';

/**
 * Selection policy: command prefix, global rate limit, per-user cooldown.
 * `consider()` is read-only; call `markAccepted()` once a comment is actually taken.
 */
export class Selector {
  private lastAcceptedAt = 0;
  private lastByUser = new Map<string, number>();

  consider(
    msg: ChatMessage,
    s: Settings,
    now = Date.now(),
  ): { ok: true; text: string } | { ok: false; reason: FilterReason } {
    let text = msg.text.trim();
    if (s.commandPrefix) {
      if (!text.toLowerCase().startsWith(s.commandPrefix.toLowerCase())) return { ok: false, reason: 'no_command_prefix' };
      text = text.slice(s.commandPrefix.length).trim();
      if (!text) return { ok: false, reason: 'empty' };
    }
    if (now - this.lastAcceptedAt < s.minIntervalSec * 1000) return { ok: false, reason: 'rate_limit' };
    const lastUser = this.lastByUser.get(msg.authorId) ?? 0;
    if (!msg.isOwner && now - lastUser < s.userCooldownSec * 1000) return { ok: false, reason: 'user_cooldown' };
    return { ok: true, text };
  }

  markAccepted(msg: ChatMessage, now = Date.now()): void {
    this.lastAcceptedAt = now;
    this.lastByUser.set(msg.authorId, now);
  }

  reset(): void {
    this.lastAcceptedAt = 0;
    this.lastByUser.clear();
  }
}
