import type { GenerateBackend, GenerateRequest, GenerateResult } from '../types.js';

/**
 * Mock backend: no API calls, no cost. Produces a "card" clip that the overlay renders
 * as an animated text card for `durationSec`. Exercises the full loop for free.
 */
export class MockBackend implements GenerateBackend {
  readonly name = 'mock' as const;
  constructor(private latencyMs = 2500) {}
  estimateCostUsd(): number {
    return 0;
  }
  async generate(req: GenerateRequest, signal: AbortSignal): Promise<GenerateResult> {
    const t0 = Date.now();
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, this.latencyMs);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        reject(new Error('aborted'));
      });
    });
    return { clipUrl: '', kind: 'card', genMs: Date.now() - t0, costUsd: 0, backend: 'mock', expandedPrompt: req.prompt };
  }
}
