import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { normalize } from './ngfilter.js';

/**
 * F-16: real idols, groups, existing anime/game characters and titles, and "make her look like X" /
 * "do X's choreography" requests. Applied to comments, reply lines, persona text and gacha prompts.
 * Blocked = silent. The list is data/ip-names.txt (+ the streamer's extra words).
 */
export class IpGuard {
  private latin: RegExp[] = [];
  private cjk: string[] = [];

  constructor(listFile = path.join(DATA_DIR, 'ip-names.txt')) {
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(listFile, 'utf8').split('\n');
    } catch {
      /* no list */
    }
    for (const raw of lines) {
      const w = raw.replace(/#.*$/, '').trim();
      if (!w) continue;
      if (/^[\x20-\x7eÀ-ɏ'’.()\-\/]+$/.test(w)) {
        // Latin: word boundaries so "IVE" does not hit "give"; punctuation escaped.
        const esc = w.toLowerCase().replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&').replace(/\s+/g, '\\s*');
        this.latin.push(new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`, 'i'));
      } else {
        this.cjk.push(normalize(w));
      }
    }
  }

  /** Returns the matched name or pattern, or null when clean. */
  match(text: string): string | null {
    const raw = text.normalize('NFKC');
    const lower = raw.toLowerCase();
    for (const re of this.latin) {
      const m = re.exec(lower);
      if (m) return m[0].trim();
    }
    const norm = normalize(raw);
    for (const w of this.cjk) if (w && norm.includes(w)) return w;
    for (const re of LIKENESS_PATTERNS) {
      const m = re.exec(raw);
      if (m) return m[0];
    }
    return null;
  }

  get size(): number {
    return this.latin.length + this.cjk.length;
  }
}

/** "Make her look like …", "cosplay as …", "do …'s choreo" — likeness and choreography requests. */
export const LIKENESS_PATTERNS: RegExp[] = [
  /\b(look|looks|looking|dress|dressed|dress up|make her look|turn her into) (like|as)\b/i,
  /\b(lookalike|look-alike|doppelg[aä]nger|impersonat\w*|imitat\w*|cosplay(ing)? (as|of))\b/i,
  /\b(choreo|choreography|cover dance|dance cover|dance to|the dance from)\b/i,
  /\bcover of\b/i,
  /に似せ|そっくり|に似た|の顔で|の姿で|になりきっ|のコスプレ|の振付|振り付け|の踊り|のダンスを踊/u,
  /닮게|처럼 생기|코스프레|안무|커버댄스|따라 춤/u,
];
