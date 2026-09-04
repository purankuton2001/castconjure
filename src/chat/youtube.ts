import type { ChatAdapter, ChatAdapterEvents } from './adapter.js';
import type { ChatMessage } from '../types.js';

/**
 * YouTube Live Chat via Data API v3 with an API key only (no OAuth).
 *   videos.list(part=liveStreamingDetails) -> activeLiveChatId
 *   liveChatMessages.list(part=snippet,authorDetails) polled at the server-provided pollingIntervalMillis.
 * Quota: default 10,000 units/day per project. We never poll faster than pollingIntervalMillis
 * (optionally slower via YOUTUBE_MIN_POLL_MS). Unit cost per poll is configurable and logged as an estimate.
 */
export interface YouTubeAdapterOptions {
  apiKey: string;
  videoId: string;
  unitsPerPoll: number;
  minPollMs: number;
  onMetric?: (ev: string, fields: Record<string, unknown>) => void;
}

const API = 'https://www.googleapis.com/youtube/v3';

export class YouTubeAdapter implements ChatAdapter {
  readonly platform = 'youtube';
  private events?: ChatAdapterEvents;
  private timer?: NodeJS.Timeout;
  private stopped = true;
  private pageToken?: string;
  private liveChatId?: string;
  private polls = 0;
  private lastIntervalMs = 0;
  private baselineDone = false;
  private seen = new Set<string>();

  constructor(private opts: YouTubeAdapterOptions) {}

  stats() {
    return { polls: this.polls, estUnits: this.polls * this.opts.unitsPerPoll + 1, lastIntervalMs: this.lastIntervalMs };
  }

  async start(events: ChatAdapterEvents): Promise<void> {
    this.events = events;
    this.stopped = false;
    if (!this.opts.apiKey) throw new Error('YOUTUBE_API_KEY is not set');
    if (!this.opts.videoId) throw new Error('YouTube video ID is not set');
    this.liveChatId = await this.resolveLiveChatId(this.opts.videoId);
    events.onStatus(true, `youtube: video ${this.opts.videoId}`);
    events.onLog('info', `youtube: liveChatId resolved (${this.liveChatId.slice(0, 12)}…)`);
    void this.poll();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.events?.onStatus(false, 'stopped');
    this.events = undefined;
  }

  private async resolveLiveChatId(videoId: string): Promise<string> {
    const url = `${API}/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${this.opts.apiKey}`;
    const res = await fetch(url);
    const body = (await res.json()) as {
      error?: { message: string };
      items?: { liveStreamingDetails?: { activeLiveChatId?: string } }[];
    };
    if (!res.ok) throw new Error(`videos.list failed: ${body.error?.message ?? res.status}`);
    const id = body.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!id) throw new Error('No active live chat for this video (is the stream live? is chat enabled?)');
    this.opts.onMetric?.('youtube_resolve', { videoId, estUnits: 1 });
    return id;
  }

  private async poll(): Promise<void> {
    if (this.stopped || !this.liveChatId || !this.events) return;
    const params = new URLSearchParams({
      liveChatId: this.liveChatId,
      part: 'snippet,authorDetails',
      maxResults: '200',
      key: this.opts.apiKey,
    });
    if (this.pageToken) params.set('pageToken', this.pageToken);
    const t0 = Date.now();
    let intervalMs = 5000;
    try {
      const res = await fetch(`${API}/liveChatMessages?${params}`);
      const body = (await res.json()) as {
        error?: { message: string; errors?: { reason?: string }[] };
        pollingIntervalMillis?: number;
        nextPageToken?: string;
        offlineAt?: string;
        items?: {
          id: string;
          snippet?: { type?: string; displayMessage?: string; publishedAt?: string; authorChannelId?: string };
          authorDetails?: { displayName?: string; channelId?: string; isChatModerator?: boolean; isChatOwner?: boolean };
        }[];
      };
      this.polls++;
      if (!res.ok) {
        const reason = body.error?.errors?.[0]?.reason ?? '';
        this.events.onLog('error', `youtube poll failed: ${body.error?.message ?? res.status}`);
        this.opts.onMetric?.('youtube_poll_error', { status: res.status, reason, ms: Date.now() - t0 });
        if (reason === 'quotaExceeded' || reason === 'liveChatEnded' || reason === 'forbidden') {
          this.events.onStatus(false, `youtube: ${reason}`);
          return; // don't hammer the API
        }
        intervalMs = 15000;
      } else {
        intervalMs = Math.max(body.pollingIntervalMillis ?? 5000, this.opts.minPollMs);
        this.lastIntervalMs = intervalMs;
        this.pageToken = body.nextPageToken;
        const items = body.items ?? [];
        this.opts.onMetric?.('youtube_poll', {
          items: items.length,
          pollingIntervalMillis: body.pollingIntervalMillis,
          ms: Date.now() - t0,
          estUnits: this.opts.unitsPerPoll,
        });
        if (body.offlineAt) {
          this.events.onLog('warn', 'youtube: stream went offline');
          this.events.onStatus(false, 'youtube: offline');
          return;
        }
        // First page is chat history since the stream began: treat it as baseline, do not generate from it.
        if (!this.baselineDone) {
          this.baselineDone = true;
          for (const it of items) this.seen.add(it.id);
          this.events.onLog('info', `youtube: baseline ${items.length} historical messages skipped`);
        } else {
          const now = Date.now();
          for (const it of items) {
            if (this.seen.has(it.id)) continue;
            this.seen.add(it.id);
            if (it.snippet?.type && it.snippet.type !== 'textMessageEvent' && it.snippet.type !== 'superChatEvent') continue;
            const text = it.snippet?.displayMessage ?? '';
            if (!text) continue;
            const msg: ChatMessage = {
              id: it.id,
              platform: 'youtube',
              authorName: it.authorDetails?.displayName ?? 'viewer',
              authorId: it.authorDetails?.channelId ?? it.snippet?.authorChannelId ?? 'unknown',
              text,
              publishedAt: it.snippet?.publishedAt ? Date.parse(it.snippet.publishedAt) : now,
              receivedAt: now,
              isModerator: !!it.authorDetails?.isChatModerator,
              isOwner: !!it.authorDetails?.isChatOwner,
            };
            this.events.onMessage(msg);
          }
          if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000));
        }
      }
    } catch (e) {
      this.events.onLog('error', `youtube poll exception: ${(e as Error).message}`);
      intervalMs = 15000;
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.poll(), intervalMs);
  }
}
