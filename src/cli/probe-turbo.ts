/** Probe: H3 Max Turbo image-to-video (first frame = scene reference) vs H3 Max image-to-video. Speed, audio track, cost. */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { falQueue } from '../backend/fal.js';
import { loadSettings, secrets } from '../config.js';
import { fileDataUri, loadPersona, seedTemplates } from '../persona/store.js';
import { buildPrompt } from '../prompt/builder.js';
const s = loadSettings(); seedTemplates();
const p = loadPersona(s.personaId)!;
const scene = fileDataUri(p.id, p.references.scene)!;
const action = 'She springs up from the floor and dances energetically in the middle of the room — full-body movement, arms swinging, spinning once, big grin.';
const prompt = buildPrompt({ comment: 'dance!!', action, reply: "taro_k, let's do it!", refCount: 1, refKinds: ['scene'], hasVoice: false }, { ...s, audio: true }, p)
  .replace('setting as in Image 1', 'exactly the person and room of the first frame');
const base = { prompt, duration: 5, resolution: '480P', prompt_expansion_mode: 'balanced', enable_safety_checker: true, image_url: scene };
for (const model of (process.argv[2] ? [process.argv[2]] : ['minimax/h3-max-turbo/image-to-video', 'minimax/h3-max/image-to-video'])) {
  const t0 = Date.now(); let timing: unknown;
  try {
    const out = await falQueue<{ video?: { url?: string }; timings?: unknown }>(model, base, undefined, secrets.falKey, { sync: false, timing: (t) => (timing = t) });
    const file = `data/clips/probe-${model.split('/')[1]}.mp4`;
    fs.writeFileSync(file, Buffer.from(await (await fetch(out.video!.url!)).arrayBuffer()));
    const pr = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' });
    console.log(`${model}: wall ${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(timing)} timings ${JSON.stringify(out.timings)} streams=[${pr.stdout.trim().split('\n').join(',')}] → ${file}`);
  } catch (e) { console.log(`${model}: FAILED ${(e as Error).message.slice(0, 300)}`); }
}
