import type { Persona, Settings } from '../types.js';

/**
 * F-04: world (per stream, falls back to the persona's) + persona appearance/forbidden + viewer comment
 * + reply line + audio instruction. Reference images are referred to by position: Image 1 = face,
 * Image 2 = full body, Image 3 = in-scene.
 */
export interface PromptInput {
  comment: string;
  reply?: string;
  refCount: number;
  hasVoice: boolean;
}

export function buildPrompt(input: PromptInput, s: Settings, persona: Persona | null): string {
  const parts: string[] = [];
  const world = (s.worldPrompt.trim() || persona?.worldPrompt?.trim() || '').trim();
  if (world) parts.push(world);

  if (persona) {
    const refs = input.refCount > 0 ? ` (appearance exactly as in Image 1${input.refCount > 1 ? `, outfit as in Image 2` : ''}${input.refCount > 2 ? `, setting as in Image 3` : ''})` : '';
    parts.push(`The main character is "${persona.nameEn || persona.name}"${refs}: ${persona.appearance.summary}`.replace(/\.?$/, '.'));
    if (persona.appearance.signatures?.length) parts.push(`Always visible: ${persona.appearance.signatures.join(', ')}.`);
    if (persona.forbidden.length) parts.push(`Never: ${persona.forbidden.join('; ')}.`);
  }

  parts.push(`She reacts to a viewer's comment: "${sanitizeComment(input.comment)}". She does what the comment asks, in this setting, expressively.`);
  if (input.reply) {
    parts.push(
      s.audio
        ? `She says, in Japanese, looking at the camera: "${sanitizeComment(input.reply)}"${input.hasVoice ? ' — her voice matches Audio 1.' : '.'}`
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
  return buildPrompt({ comment: '', refCount, hasVoice: false }, { ...s, audio: false }, persona)
    .replace(/She reacts to a viewer's comment: "".*\n/, `${action} She starts and ends in the same seated pose facing the camera, so the clip loops.\n`);
}

export function sanitizeComment(text: string): string {
  return text
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/["“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
