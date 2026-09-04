import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import type { FilterReason } from '../types.js';

/**
 * NG filter. Blocks: URLs, blocklisted words (built-in + streamer), and
 * heuristic "real person" references. False positives are acceptable by design;
 * blocked comments produce no visible reaction.
 */
export class NgFilter {
  private builtin: string[] = [];

  constructor(listFile = path.join(DATA_DIR, 'ng-words.txt')) {
    try {
      this.builtin = fs
        .readFileSync(listFile, 'utf8')
        .split('\n')
        .map((l) => l.replace(/#.*$/, '').trim())
        .filter(Boolean)
        .map(normalize);
    } catch {
      this.builtin = [];
    }
  }

  /** Returns null if allowed, otherwise the reason. */
  check(text: string, extraWords: string[], maxChars: number): FilterReason | null {
    const raw = text.trim();
    if (!raw) return 'empty';
    if (raw.length > maxChars) return 'too_long';
    if (/https?:\/\/|www\.|\.(com|net|jp|io|dev|app)\b/i.test(raw)) return 'url';
    const norm = normalize(raw);
    for (const w of this.builtin) if (w && norm.includes(w)) return 'ng_word';
    for (const w of extraWords.map(normalize)) if (w && norm.includes(w)) return 'ng_word';
    if (looksLikeRealPerson(raw)) return 'real_person';
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
