/**
 * Generate the persona's ack pool: short spoken "noticed your comment" clips played instantly while the
 * reaction generates (no spoiler, no dead time). Usage: npm run ack -- --n 6
 */
import { loadSettings } from '../config.js';
import { seedTemplates } from '../persona/store.js';
import { Pipeline } from '../queue/pipeline.js';

const args = process.argv.slice(2);
const n = Number(args[args.indexOf('--n') + 1] || 6);
seedTemplates();
const pipeline = new Pipeline(loadSettings());
if (!pipeline.activePersona) throw new Error('no persona selected');
console.log(`ack pool: persona=${pipeline.activePersona.id} mode=${pipeline.settings.genMode} count=${n} estimate=$${(pipeline.estimateClipCostUsd() * n).toFixed(2)}`);
pipeline.subscribe((m) => { if (m.type === 'log') console.log(`[${m.level}] ${m.line}`); });
await pipeline.generateAckPool(n);
console.log(`done: ${pipeline.activePersona?.ack?.clips.length ?? 0} ack clips, spent $${pipeline.spentUsd.toFixed(2)}`);
pipeline.metrics.close();
process.exit(0);
