import { loadSettings, secrets } from './config.js';
import { Pipeline } from './queue/pipeline.js';
import { createServer } from './server/http.js';

const settings = loadSettings();
const pipeline = new Pipeline(settings);
createServer(pipeline, secrets.port);

const base = `http://127.0.0.1:${secrets.port}`;
console.log(`
  castconjure
  ─────────────────────────────────────────
  config UI : ${base}/
  OBS source: ${base}/overlay   (browser source, 1920x1080, transparent)
  backend   : ${pipeline.effectiveBackend}   platform: ${settings.platform}
  metrics   : ${pipeline.metrics.file}
`);

if (process.env.AUTOSTART === '1') void pipeline.start();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await pipeline.stop();
    pipeline.metrics.close();
    process.exit(0);
  });
}
