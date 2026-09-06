/**
 * Developer path for your OWN original character art (no UI upload exists by design):
 * copy an illustration/render you made or generated as the face reference, derive full-body and
 * in-scene references, and set the style. Never use a photo of a real person or someone else's character.
 *
 *   npm run persona:import -- --id yui-anime --name "Yui (anime)" --style anime --face ~/Desktop/yui.png [--from shirotsume-yui]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createImageGen, FACE_SAFETY_SUFFIX, STYLE_SUFFIX, saveRef } from '../persona/facegen.js';
import { createPersona, fileDataUri, loadPersona, personaDir, savePersona, seedTemplates } from '../persona/store.js';

const args = process.argv.slice(2);
const opt = (k: string, d = '') => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const id = opt('id').toLowerCase().replace(/[^a-z0-9_-]/g, '');
const face = opt('face');
const style = opt('style', 'anime') === 'anime' ? 'anime' : 'photoreal';
if (!id || !face || !fs.existsSync(face)) {
  console.error('usage: npm run persona:import -- --id <id> --face <your-own-artwork.png> [--name ..] [--style anime|photoreal] [--from <personaId>]');
  process.exit(1);
}
seedTemplates();
let p = loadPersona(id);
if (!p) {
  const from = opt('from') ? loadPersona(opt('from')) : null;
  p = from ? savePersona({ ...from, id, name: opt('name', from.name), references: {}, idle: { clips: [] } }) : createPersona(id, opt('name', id));
}
p.style = style;
const dir = path.join(personaDir(id), 'refs');
fs.mkdirSync(dir, { recursive: true });
const ext = path.extname(face).toLowerCase() || '.png';
const faceRel = `refs/face${ext}`;
fs.copyFileSync(face, path.join(personaDir(id), faceRel));
const gen = createImageGen();
const faceUri = fileDataUri(id, faceRel)!;
const suffix = `${p.referencePrompts?.suffix ?? ''} ${STYLE_SUFFIX[style]}, ${FACE_SAFETY_SUFFIX}`;
console.log(`persona=${id} style=${style} imagegen=${gen.name} — deriving full-body and in-scene references…`);
const full = await gen.edit(faceUri, `Full-body illustration of the same character as in the input image, identical face, hair and hair accessory. ${p.referencePrompts?.full ?? p.appearance.defaultOutfit ?? ''}. ${suffix}`, 1);
const fullRel = saveRef(id, 'full', full.bytes, full.ext);
const scene = await gen.edit(faceUri, `The same character as in the input image, identical face, hair and hair accessory, ${p.referencePrompts?.scene ?? p.appearance.defaultScene ?? 'in her room'}. ${suffix}`, 2);
const sceneRel = saveRef(id, 'scene', scene.bytes, scene.ext);
p.references = { ...p.references, face: faceRel, full: fullRel, scene: sceneRel, confirmed: false, note: 'Imported by the owner (own original character). Never a photo of a real person or someone else\'s character.' };
savePersona(p);
console.log(`done: ${faceRel}, ${fullRel}, ${sceneRel} (cost $${(full.costUsd + scene.costUsd).toFixed(2)}). Review data/personas/${id}/refs/, then confirm in the panel and set PERSONA_ID=${id} (or select it in the panel).`);
