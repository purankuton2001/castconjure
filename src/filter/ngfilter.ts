import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import type { FilterReason } from '../types.js';
import { IpGuard } from './ipguard.js';

/**
 * NG filter. Blocks: URLs, blocklisted words (built-in + streamer), and
 * heuristic "real person" references. False positives are acceptable by design;
 * blocked comments produce no visible reaction.
 */
export class NgFilter {
  private builtin: string[] = [];
  private latin: RegExp[] = [];
  readonly ip = new IpGuard();

  constructor(listFile = path.join(DATA_DIR, 'ng-words.txt')) {
    try {
      const words = fs
        .readFileSync(listFile, 'utf8')
        .split('\n')
        .map((l) => l.replace(/#.*$/, '').trim())
        .filter(Boolean);
      // Latin words: word boundaries (so "something" never hits "meth"); CJK: substring after normalization
      for (const w of words) {
        if (/^[\x20-\x7e]+$/.test(w)) this.latin.push(new RegExp(`(^|[^a-z0-9])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i'));
        else this.builtin.push(normalize(w));
      }
    } catch {
      this.builtin = [];
    }
  }

  /**
   * Returns null if allowed, otherwise the reason.
   * `allowNames` skips the real-person heuristic — used for the persona's own reply lines, which
   * address the viewer as "〇〇さん" by design (the line is spoken, never depicted).
   */
  check(text: string, extraWords: string[], maxChars: number, opts: { allowNames?: boolean } = {}): FilterReason | null {
    const raw = text.trim();
    if (!raw) return 'empty';
    if (raw.length > maxChars) return 'too_long';
    if (/https?:\/\/|www\.|\.(com|net|jp|io|dev|app)\b/i.test(raw)) return 'url';
    if (this.ip.match(raw)) return 'ip';
    const norm = normalize(raw);
    const lower = raw.normalize('NFKC').toLowerCase();
    for (const re of this.latin) if (re.test(lower)) return 'ng_word';
    for (const w of this.builtin) if (w && norm.includes(w)) return 'ng_word';
    for (const w of extraWords) {
      if (/^[\x20-\x7e]+$/.test(w)) { if (new RegExp(`(^|[^a-z0-9])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i').test(lower)) return 'ng_word'; }
      else if (normalize(w) && norm.includes(normalize(w))) return 'ng_word';
    }
    if (!opts.allowNames && looksLikeRealPerson(raw)) return 'real_person';
    return null;
  }
}

export function normalize(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s　]+/g, '');
}

/**
 * Heuristics for real-person references (spec §7-1: unconditional exclusion, false positives OK).
 *  - Japanese honorific after a 1–6 char name-like run: 〇〇さん / ちゃん / くん / 氏 / 様 / 先生
 *  - Two consecutive Capitalized Latin words ("Taylor Swift", "Elon Musk")
 *  - @mentions
 */
export function looksLikeRealPerson(text: string): boolean {
  if (/@[\w\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/u.test(text)) return true;
  // Name-like run (kanji / katakana / latin; hiragana excluded so たくさん・ごくろうさん don't trip it) + honorific.
  if (/[\p{Script=Han}\p{Script=Katakana}A-Za-z]{1,8}(さん|ちゃん|くん|君|氏|様|さま|先生|せんせい)/u.test(text)) return true;
  if (/\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/.test(text)) return true;
  return false;
}
