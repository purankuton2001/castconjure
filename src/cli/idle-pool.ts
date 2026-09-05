/**
 * Generate the persona's idle pool from the command line (independent of the server).
 * Usage: npm run idle -- --n 12
 * Restart the server afterwards so it reloads data/personas/<id>/persona.json.
 */
import { loadSettings } from '../config.js';
import { seedTemplates } from '../persona/store.js';
import { Pipeline } from '../queue/pipeline.js';

const args = process.argv.slice(2);
const n = Number(args[args.indexOf('--n') + 1] || 12);
seedTemplates();
const pipeline = new Pipeline(loadSettings());
const p = pipeline.activePersona;
if (!p) throw new Error('no persona selected (PERSONA_ID)');
console.log(`idle pool: persona=${p.id} backend=${pipeline.effectiveBackend} count=${n} estimate=$${(pipeline.estimateClipCostUsd() * n).toFixed(2)}`);
pipeline.subscribe((m) => {
  if (m.type === 'log') console.log(`[${m.level}] ${m.line}`);
  if (m.type === 'state' && m.state.idleJob) process.stdout.write(`\r${m.state.idleJob.done}/${m.state.idleJob.total} spent=$${m.state.spentUsd.toFixed(2)}   `);
});
await pipeline.generateIdlePool(n);
console.log(`\ndone: ${pipeline.activePersona?.idle?.clips.length ?? 0} clips, spent $${pipeline.spentUsd.toFixed(2)}, log ${pipeline.metrics.file}`);
pipeline.metrics.close();
process.exit(0);
