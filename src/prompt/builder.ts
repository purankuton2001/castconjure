import type { Persona, Settings } from '../types.js';

/**
 * F-04: world (per stream, falls back to the persona's) + persona appearance/forbidden + viewer comment
 * + reply line + audio instruction. Reference images are referred to by position: Image 1 = face,
 * Image 2 = full body, Image 3 = in-scene.
 */
export interface PromptInput {
  comment: string;
  reply?: string;
  /** Director line: the concrete full-body action to show (defaults to acting out the comment). */
  action?: string;
  refCount: number;
  /** Kinds of the reference images in order (Image 1, 2, …). Defaults to face, full, scene. */
  refKinds?: ('face' | 'full' | 'scene')[];
  hasVoice: boolean;
}

export function buildPrompt(input: PromptInput, s: Settings, persona: Persona | null): string {
  const parts: string[] = [];
  const world = (s.worldPrompt.trim() || persona?.worldPrompt?.trim() || '').trim();
  if (world) parts.push(world);

  if (persona) {
    const kinds = (input.refKinds ?? (['face', 'full', 'scene'] as const).slice(0, input.refCount)).slice(0, input.refCount);
    const label = { face: 'appearance exactly as in Image', full: 'outfit as in Image', scene: 'setting as in Image' } as const;
    const refs = kinds.length ? ` (${kinds.map((k, i) => `${label[k]} ${i + 1}`).join(', ')})` : '';
    parts.push(`The main character is "${persona.nameEn || persona.name}"${refs}: ${persona.appearance.summary}`.replace(/\.?$/, '.'));
    if (persona.appearance.signatures?.length) parts.push(`Always visible: ${persona.appearance.signatures.join(', ')}.`);
    parts.push(
      persona.style === 'anime'
        ? '2D anime style, clean cel shading, consistent character design across the whole clip, adult proportions.'
        : 'Photoreal, natural skin texture, handheld 35mm look.',
    );
    if (persona.forbidden.length) parts.push(`Never: ${persona.forbidden.join('; ')}.`);
  }

  if (input.comment.trim()) parts.push(`A viewer commented: "${sanitizeComment(input.comment)}".`);
  parts.push(input.action?.trim() || `She acts out the request with her whole body, expressively, standing up if it helps.`);
  if (input.refCount > 0 && input.comment.trim()) parts.push('The reference images define her appearance only, not her pose: she may stand up, move around and use the whole frame.');
  if (input.reply) {
    const lang = /[\uac00-\ud7a3]/.test(input.reply) ? 'Korean' : /[\u3040-\u30ff\u4e00-\u9fff]/.test(input.reply) ? 'Japanese' : 'English';
    parts.push(
      s.audio
        ? `She says, in ${lang}, looking at the camera, cheerfully and clearly: "${sanitizeComment(input.reply)}"${input.hasVoice ? ' — her voice matches Audio 1.' : '.'}`
        : `Her expression conveys the line: "${sanitizeComment(input.reply)}" (no lip movement required, no on-screen text).`,
    );
  }
  parts.push('Single continuous shot, keep the style consistent. No captions, no subtitles, no on-screen text.');
  parts.push(s.audio ? 'Natural ambient sound; only her voice, no other dialogue.' : 'No audio.');
  parts.push('No real people, no celebrities, no brand logos, no minors.');
  return parts.join('\n');
}

/** Idle-pool prompts (F-13): subtle, loopable, same framing as the scene reference. */
export const IDLE_PROMPTS = [
  'She sits relaxed, glances at the camera and smiles softly, then looks away. Minimal motion.',
  'She adjusts her hair pin with one hand and settles back. Calm, small movements.',
  'She sips from a white mug, exhales happily, and sets it down.',
  'She stretches her arms above her head, yawns a little, and relaxes.',
  'She hums quietly while tapping her fingers on her knee, looking around the room.',
  'She leans toward the camera curiously, then leans back with a small laugh.',
  'She tucks her hair behind her ear and rests her chin on her hand, thinking.',
  'She waves lightly at the camera, then folds her hands in her lap.',
  'She looks out the window at the sunset for a moment, then back at the camera.',
  'She fidgets with the sleeve of her cardigan, smiling to herself.',
  'She nods along to some unheard music, shoulders swaying slightly.',
  'She takes a slow breath, closes her eyes for a second, and opens them with a smile.',
];

export function buildIdlePrompt(index: number, s: Settings, persona: Persona | null, refCount: number): string {
  const action = IDLE_PROMPTS[index % IDLE_PROMPTS.length];
  return buildPrompt({ comment: '', action: `${action} She starts and ends in the same seated pose facing the camera, so the clip loops.`, refCount, hasVoice: false }, { ...s, audio: false }, persona);
}

export function sanitizeComment(text: string): string {
  return text
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/["“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
