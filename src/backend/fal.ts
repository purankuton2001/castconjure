import { pricing, secrets } from '../config.js';
import type { GenerateBackend, GenerateRequest, GenerateResult } from '../types.js';

/** Submit to the fal queue REST API and wait for the result. Shared by video, image and TTS calls. */
export async function falQueue<T>(model: string, input: Record<string, unknown>, signal?: AbortSignal, key = secrets.falKey): Promise<T> {
  if (!key) throw new Error('FAL_KEY is not set (BYOK: create one at fal.ai/dashboard/keys)');
  const headers = { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
  const submit = await fetch(`https://queue.fal.run/${model}`, { method: 'POST', headers, body: JSON.stringify(input), signal });
  if (!submit.ok) throw new Error(`fal submit ${model} ${submit.status}: ${(await submit.text()).slice(0, 300)}`);
  const { status_url, response_url } = (await submit.json()) as { request_id: string; status_url: string; response_url: string };
  for (;;) {
    if (signal?.aborted) throw new Error('aborted');
    await new Promise((r) => setTimeout(r, 500));
    const st = await fetch(status_url, { headers, signal });
    if (!st.ok) throw new Error(`fal status ${st.status}`);
    const s = (await st.json()) as { status: string; error?: unknown };
    if (s.status === 'COMPLETED') break;
    if (s.status !== 'IN_QUEUE' && s.status !== 'IN_PROGRESS') throw new Error(`fal status ${s.status}: ${JSON.stringify(s.error ?? '')}`);
  }
  const out = await fetch(response_url, { headers, signal });
  if (!out.ok) throw new Error(`fal result ${out.status}: ${(await out.text()).slice(0, 300)}`);
  return (await out.json()) as T;
}

/**
 * fal backend for MiniMax H3 Max.
 *   text-to-video      : no reference images
 *   reference-to-video : persona reference images (+ reference voice when audio is on)
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
    if (useRef) {
      input.reference_image_urls = req.referenceImageUrls;
      if (req.audio && req.referenceAudioUrl) input.reference_audio_urls = [req.referenceAudioUrl];
    }
    const body = await falQueue<{ video?: { url?: string }; expanded_prompt?: string; timings?: unknown; seed?: number }>(model, input, signal, this.key);
    const url = body.video?.url;
    if (!url) throw new Error('fal result has no video url');
    return {
      clipUrl: url,
      kind: 'video',
      genMs: Date.now() - t0,
      costUsd: this.estimateCostUsd(req),
      backend: 'fal',
      expandedPrompt: body.expanded_prompt,
      raw: { timings: body.timings, seed: body.seed },
    };
  }
}
