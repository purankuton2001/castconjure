import fs from 'node:fs';
import path from 'node:path';
import { PERSONAS_DIR, PERSONA_TEMPLATES_DIR } from '../config.js';
import type { Persona } from '../types.js';

/**
 * Persona store. A persona is a folder: data/personas/<id>/{persona.json, refs/, voice.*, idle/}.
 * Bundled templates in personas/ are seeded (persona.json only) on first boot.
 */
export function personaDir(id: string): string {
  const safe = id.replace(/[^a-z0-9_-]/gi, '');
  if (!safe) throw new Error('invalid persona id');
  return path.join(PERSONAS_DIR, safe);
}

export function seedTemplates(): void {
  fs.mkdirSync(PERSONAS_DIR, { recursive: true });
  if (!fs.existsSync(PERSONA_TEMPLATES_DIR)) return;
  for (const d of fs.readdirSync(PERSONA_TEMPLATES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const src = path.join(PERSONA_TEMPLATES_DIR, d.name, 'persona.json');
    const dstDir = path.join(PERSONAS_DIR, d.name);
    if (fs.existsSync(src) && !fs.existsSync(path.join(dstDir, 'persona.json'))) {
      fs.mkdirSync(dstDir, { recursive: true });
      fs.copyFileSync(src, path.join(dstDir, 'persona.json'));
    }
  }
}

export function listPersonas(): Persona[] {
  if (!fs.existsSync(PERSONAS_DIR)) return [];
  return fs
    .readdirSync(PERSONAS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => loadPersona(d.name))
    .filter((p): p is Persona => !!p);
}

export function loadPersona(id: string): Persona | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(personaDir(id), 'persona.json'), 'utf8')) as Persona;
    return normalize({ ...raw, id });
  } catch {
    return null;
  }
}

export function savePersona(p: Persona): Persona {
  const n = normalize(p);
  const dir = personaDir(n.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'persona.json'), JSON.stringify(n, null, 2));
  return n;
}

export function createPersona(id: string, name: string): Persona {
  const p: Persona = {
    id,
    name,
    adult: true,
    seed: Math.floor(Math.random() * 2 ** 31),
    appearance: { summary: '' },
    references: {},
    personality: { verbalTics: [], replyMaxChars: 30 },
    forbidden: [],
  };
  return savePersona(p);
}

function normalize(p: Persona): Persona {
  return {
    ...p,
    adult: true,
    seed: Number.isFinite(p.seed) ? Math.floor(p.seed as number) : Math.floor(Math.random() * 2 ** 31),
    appearance: { ...(p.appearance ?? {}), summary: p.appearance?.summary ?? '' },
    references: { ...(p.references ?? {}) },
    personality: { verbalTics: [], replyMaxChars: 30, ...(p.personality ?? {}) },
    forbidden: Array.isArray(p.forbidden) ? p.forbidden : [],
    idle: { clips: [], ...(p.idle ?? {}) },
    ack: { clips: [], ...(p.ack ?? {}) },
  };
}

/** Public URL for a file inside a persona dir. */
export function personaUrl(id: string, rel: string): string {
  return `/personas/${encodeURIComponent(id)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', wav: 'audio/wav', mp3: 'audio/mpeg' };

/** Resolve a persona-relative file to a data URI a backend can fetch. */
export function fileDataUri(id: string, rel: string | undefined): string | undefined {
  if (!rel) return undefined;
  const p = path.join(personaDir(id), rel);
  if (!fs.existsSync(p)) return undefined;
  const ext = path.extname(p).slice(1).toLowerCase();
  return `data:${MIME[ext] ?? 'application/octet-stream'};base64,${fs.readFileSync(p).toString('base64')}`;
}

/** Reference images in the order the prompt refers to them: Image 1 = face, 2 = full, 3 = scene. */
export function referenceImageUris(p: Persona): string[] {
  return [p.references.face, p.references.full, p.references.scene]
    .map((f) => fileDataUri(p.id, f))
    .filter((u): u is string => !!u);
}

/** Reference voice for a language, falling back to the primary voice. */
export function referenceVoiceUri(p: Persona, lang?: string): string | undefined {
  const rel = (lang && p.references.voices?.[lang]) || p.references.voice;
  return fileDataUri(p.id, rel);
}
