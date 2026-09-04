import type { Settings } from '../types.js';

/**
 * Prompt = world (per-stream) + character (fixed) + viewer comment + audio instruction.
 * The comment is quoted and sanitized so it steers the scene without overriding the world.
 */
export function buildPrompt(comment: string, s: Settings, hasReferenceImages: boolean): string {
  const parts: string[] = [];
  const world = s.worldPrompt.trim();
  if (world) parts.push(world);

  const c = s.character;
  if (c.name || c.description) {
    const who = c.name ? `The main character is "${c.name}"` : 'The main character';
    const desc = c.description.trim() ? `: ${c.description.trim()}` : '';
    const ref = hasReferenceImages ? ' (appearance exactly as in Image 1)' : '';
    parts.push(`${who}${ref}${desc}.`);
    if (c.forbidden.trim()) parts.push(`The character must never: ${c.forbidden.trim()}.`);
  }

  parts.push(`Scene inspired by a viewer's comment: "${sanitizeComment(comment)}".`);
  parts.push('Single continuous shot, keep the style consistent. No captions, no subtitles, no on-screen text.');
  parts.push(s.audio ? 'Natural ambient sound and sound effects, no dialogue.' : 'No audio.');
  parts.push('No real people, no celebrities, no brand logos.');
  return parts.join('\n');
}

export function sanitizeComment(text: string): string {
  return text
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/["“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
