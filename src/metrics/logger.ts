import fs from 'node:fs';
import path from 'node:path';
import { LOGS_DIR } from '../config.js';

/**
 * Append-only JSONL metrics. One file per process start.
 * Every record: { t: epochMs, iso, ev: string, ...fields }.
 * This is the "実測ログ" that gets published after demo streams.
 */
export class MetricsLogger {
  private stream: fs.WriteStream;
  readonly file: string;
  private listeners = new Set<(rec: Record<string, unknown>) => void>();

  constructor() {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.file = path.join(LOGS_DIR, `session-${stamp}.jsonl`);
    this.stream = fs.createWriteStream(this.file, { flags: 'a' });
  }

  log(ev: string, fields: Record<string, unknown> = {}): void {
    const t = Date.now();
    const rec = { t, iso: new Date(t).toISOString(), ev, ...fields };
    this.stream.write(JSON.stringify(rec) + '\n');
    for (const l of this.listeners) l(rec);
  }

  onRecord(fn: (rec: Record<string, unknown>) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.stream.end();
  }
}
