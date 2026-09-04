import fs from 'node:fs';
import { secrets } from '../config.js';
import type { GenerateBackend, GenerateRequest, GenerateResult } from '../types.js';

/**
 * Local backend: ComfyUI HTTP API with a user-supplied workflow (API format JSON).
 * Placeholders in the workflow JSON are substituted as strings:
 *   {{PROMPT}}  {{DURATION}}  {{RESOLUTION}}  {{SEED}}  {{FRAMES}}  {{REFERENCE_IMAGE}}
 * This is the "pre-generation mode": ~50s per 5s clip on an RTX 4090, $0.
 * See local/workflow.example.json.
 */
export class LocalBackend implements GenerateBackend {
  readonly name = 'local' as const;
  private base = secrets.comfyUrl.replace(/\/$/, '');
  private template: string;

  constructor() {
    if (!fs.existsSync(secrets.comfyWorkflow)) {
      throw new Error(`COMFY_WORKFLOW not found: ${secrets.comfyWorkflow} (copy local/workflow.example.json and adapt it)`);
    }
    this.template = fs.readFileSync(secrets.comfyWorkflow, 'utf8');
  }

  estimateCostUsd(): number {
    return 0;
  }

  async generate(req: GenerateRequest, signal: AbortSignal): Promise<GenerateResult> {
    const t0 = Date.now();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const fps = 24;
    const vars: Record<string, string> = {
      PROMPT: JSON.stringify(req.prompt).slice(1, -1),
      DURATION: String(req.durationSec),
      FRAMES: String(req.durationSec * fps + 1),
      RESOLUTION: req.resolution === '768p' ? '768' : '480',
      SEED: String(seed),
      REFERENCE_IMAGE: req.referenceImageUrls[0] ?? '',
    };
    const workflowJson = this.template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
    const workflow = JSON.parse(workflowJson) as unknown;
    const clientId = `castconjure-${t0}`;
    const submit = await fetch(`${this.base}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal,
    });
    if (!submit.ok) throw new Error(`comfy /prompt ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
    const { prompt_id } = (await submit.json()) as { prompt_id: string };

    for (;;) {
      if (signal.aborted) throw new Error('aborted');
      await new Promise((r) => setTimeout(r, 1500));
      const h = await fetch(`${this.base}/history/${prompt_id}`, { signal });
      if (!h.ok) continue;
      const hist = (await h.json()) as Record<string, { status?: { completed?: boolean; status_str?: string }; outputs?: Record<string, Record<string, unknown[]>> }>;
      const entry = hist[prompt_id];
      if (!entry) continue;
      if (entry.status?.status_str === 'error') throw new Error('comfy workflow errored');
      if (!entry.status?.completed) continue;
      const file = findOutputFile(entry.outputs ?? {});
      if (!file) throw new Error('comfy finished but no video/gif output found');
      const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder ?? '', type: file.type ?? 'output' });
      return { clipUrl: `${this.base}/view?${q}`, kind: 'video', genMs: Date.now() - t0, costUsd: 0, backend: 'local', raw: { prompt_id } };
    }
  }
}

function findOutputFile(outputs: Record<string, Record<string, unknown[]>>): { filename: string; subfolder?: string; type?: string } | null {
  for (const node of Object.values(outputs)) {
    for (const key of ['videos', 'gifs', 'images']) {
      const arr = node[key] as { filename?: string; subfolder?: string; type?: string }[] | undefined;
      const f = arr?.find((x) => x.filename && /\.(mp4|webm|mov|gif)$/i.test(x.filename));
      if (f?.filename) return { filename: f.filename, subfolder: f.subfolder, type: f.type };
    }
  }
  return null;
}
