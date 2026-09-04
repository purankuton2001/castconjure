import { pricing, secrets } from '../config.js';
import type { GenerateBackend, GenerateRequest, GenerateResult } from '../types.js';

/**
 * fal backend for MiniMax H3 Max via the fal queue REST API (no SDK dependency).
 *   text-to-video      : no reference images
 *   reference-to-video : reference images present (character consistency)
 * Endpoint IDs are configurable (FAL_T2V_MODEL / FAL_R2V_MODEL). BYOK: FAL_KEY stays on this machine.
 * Pricing (2026-09): t2v 480p $0.05/s, 768p $0.08/s; r2v $0.08/s + $0.02/reference image.
 */
export class FalBackend implements GenerateBackend {
  readonly name = 'fal' as const;

  constructor(private key = secrets.falKey) {
    if (!this.key) throw new Error('FAL_KEY is not set (BYOK: create one at fal.ai/dashboard/keys)');
  }

  estimateCostUsd(req: GenerateRequest): number {
    const n = req.referenceImageUrls.length;
    if (n > 0) return req.durationSec * pricing.r2vPerSec + n * pricing.r2vPerImage;
    return req.durationSec * (req.resolution === '768p' ? pricing.t2v768 : pricing.t2v480);
  }

  async generate(req: GenerateRequest, signal: AbortSignal): Promise<GenerateResult> {
    const t0 = Date.now();
    const useRef = req.referenceImageUrls.length > 0;
    const model = useRef ? secrets.falR2vModel : secrets.falT2vModel;
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      duration: req.durationSec,
      resolution: req.resolution === '768p' ? '768P' : '480P',
      prompt_expansion_mode: secrets.falPromptExpansion,
      enable_safety_checker: true,
      aspect_ratio: '16:9',
    };
    if (useRef) input.reference_image_urls = req.referenceImageUrls;

    const headers = { Authorization: `Key ${this.key}`, 'Content-Type': 'application/json' };
    const submit = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(input), signal });
    if (!submit.ok) throw new Error(`fal submit ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
    const { request_id, status_url, response_url } = (await submit.json()) as {
      request_id: string;
      status_url: string;
      response_url: string;
    };

    // Poll status. H3 Max typically completes in ~3s; poll at 500ms.
    for (;;) {
      if (signal.aborted) throw new Error('aborted');
      await new Promise((r) => setTimeout(r, 500));
      const st = await fetch(status_url, { headers, signal });
      if (!st.ok) throw new Error(`fal status ${st.status}`);
      const s = (await st.json()) as { status: string; error?: unknown };
      if (s.status === 'COMPLETED') break;
      if (s.status !== 'IN_QUEUE' && s.status !== 'IN_PROGRESS') throw new Error(`fal status ${s.status}: ${JSON.stringify(s.error ?? '')}`);
    }
    const out = await fetch(response_url, { headers, signal });
    if (!out.ok) throw new Error(`fal result ${out.status}: ${(await out.text()).slice(0, 300)}`);
    const body = (await out.json()) as { video?: { url?: string }; expanded_prompt?: string; timings?: unknown };
    const url = body.video?.url;
    if (!url) throw new Error(`fal result has no video url (request ${request_id})`);
    return {
      clipUrl: url,
      kind: 'video',
      genMs: Date.now() - t0,
      costUsd: this.estimateCostUsd(req),
      backend: 'fal',
      expandedPrompt: body.expanded_prompt,
      raw: { request_id, timings: body.timings },
    };
  }
}
