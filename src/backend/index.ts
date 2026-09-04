import fs from 'node:fs';
import path from 'node:path';
import { CHARACTERS_DIR } from '../config.js';
import type { BackendName, GenerateBackend } from '../types.js';
import { FalBackend } from './fal.js';
import { LocalBackend } from './local.js';
import { MockBackend } from './mock.js';

export function createBackend(name: BackendName): GenerateBackend {
  switch (name) {
    case 'fal':
      return new FalBackend();
    case 'local':
      return new LocalBackend();
    default:
      return new MockBackend();
  }
}

/**
 * Resolve character reference images to something a backend can fetch:
 * http(s) URLs pass through; local files (relative to data/characters or absolute) become data URIs.
 */
export function resolveReferenceImages(refs: string[]): string[] {
  const out: string[] = [];
  for (const r of refs.slice(0, 3)) {
    if (/^https?:\/\//i.test(r) || r.startsWith('data:')) {
      out.push(r);
      continue;
    }
    const p = path.isAbsolute(r) ? r : path.join(CHARACTERS_DIR, r);
    if (!fs.existsSync(p)) continue;
    const ext = path.extname(p).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext || 'png'}`;
    out.push(`data:${mime};base64,${fs.readFileSync(p).toString('base64')}`);
  }
  return out;
}
