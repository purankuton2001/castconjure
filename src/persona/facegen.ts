import fs from 'node:fs';
import path from 'node:path';
import { PERSONAS_DIR, personaPricing, secrets } from '../config.js';
import { falQueue } from '../backend/fal.js';
import { mockPortrait } from '../util/png.js';
import { personaDir } from './store.js';

/**
 * F-10 face gacha. Faces are only ever *generated* here — there is no upload path by design.
 * Every prompt carries a fixed safety suffix: fictional adult, not resembling any real person.
 */
export const FACE_SAFETY_SUFFIX =
  'fictional person who does not exist, adult woman in her early twenties, not resembling any real celebrity, idol or public figure, not a character from any existing anime, game or franchise, no text, no watermark';

/** Style presets (F-10): the look of the face gacha and, via the prompt builder, of every clip. */
export const STYLE_SUFFIX: Record<'photoreal' | 'anime', string> = {
  photoreal: 'photoreal, natural skin texture, no makeup retouching, 35mm photo',
  anime: 'anime style illustration, clean cel shading, soft lighting, original character design, adult proportions',
};

export interface ImageGen {
  readonly name: 'fal' | 'mock';
  /** Text → image. Returns PNG/JPEG bytes. */
  generate(prompt: string, seed: number): Promise<{ bytes: Buffer; ext: string; costUsd: number }>;
  /** Reference image + instruction → image (same person, new framing). */
  edit(imageDataUri: string, prompt: string, seed: number): Promise<{ bytes: Buffer; ext: string; costUsd: number }>;
}

export function createImageGen(): ImageGen {
  const useFal = secrets.personaImages === 'fal' || (secrets.personaImages === 'auto' && !!secrets.falKey);
  return useFal ? new FalImageGen() : new MockImageGen();
}

class MockImageGen implements ImageGen {
  readonly name = 'mock' as const;
  async generate(_prompt: string, seed: number) {
    await new Promise((r) => setTimeout(r, 300));
    return { bytes: mockPortrait(seed), ext: 'png', costUsd: 0 };
  }
  async edit(_img: string, prompt: string, seed: number) {
    await new Promise((r) => setTimeout(r, 300));
    const variant = /full-body|standing/i.test(prompt) ? 'full' : /sitting|scene|apartment|room/i.test(prompt) ? 'scene' : 'face';
    return { bytes: mockPortrait(seed, 640, 640, variant), ext: 'png', costUsd: 0 };
  }
}

class FalImageGen implements ImageGen {
  readonly name = 'fal' as const;
  async generate(prompt: string, seed: number) {
    const out = await falQueue<{ images?: { url: string; content_type?: string }[] }>(secrets.falImageModel, {
      prompt,
      image_size: 'portrait_4_3',
      num_images: 1,
      enable_safety_checker: true,
      seed,
    });
    return { ...(await download(out.images?.[0]?.url)), costUsd: personaPricing.imagePerCall };
  }
  async edit(imageDataUri: string, prompt: string, seed: number) {
    const out = await falQueue<{ images?: { url: string }[] }>(secrets.falImageEditModel, {
      prompt,
      image_url: imageDataUri,
      num_images: 1,
      seed,
      output_format: 'png',
    });
    return { ...(await download(out.images?.[0]?.url)), costUsd: personaPricing.imageEditPerCall };
  }
}

async function download(url?: string): Promise<{ bytes: Buffer; ext: string }> {
  if (!url) throw new Error('image model returned no image');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image download ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  const ext = ct.includes('jpeg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'png';
  return { bytes: Buffer.from(await res.arrayBuffer()), ext };
}

/** Candidate faces live in data/personas/_gacha/. */
export function gachaDir(): string {
  const d = path.join(PERSONAS_DIR, '_gacha');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function saveCandidate(bytes: Buffer, ext: string): string {
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  fs.writeFileSync(path.join(gachaDir(), name), bytes);
  return name;
}

/** Copy a chosen candidate into the persona as refs/face.<ext>. */
export function adoptCandidate(personaId: string, candidate: string): string {
  const src = path.join(gachaDir(), path.basename(candidate));
  if (!fs.existsSync(src)) throw new Error('candidate not found');
  const dir = path.join(personaDir(personaId), 'refs');
  fs.mkdirSync(dir, { recursive: true });
  const rel = `refs/face${path.extname(src)}`;
  fs.copyFileSync(src, path.join(personaDir(personaId), rel));
  return rel;
}

export function saveRef(personaId: string, kind: 'full' | 'scene', bytes: Buffer, ext: string): string {
  const dir = path.join(personaDir(personaId), 'refs');
  fs.mkdirSync(dir, { recursive: true });
  const rel = `refs/${kind}.${ext}`;
  fs.writeFileSync(path.join(personaDir(personaId), rel), bytes);
  return rel;
}
