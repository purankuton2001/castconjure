import type { BackendName, GenerateBackend } from '../types.js';
import { FalBackend } from './fal.js';
import { LocalBackend } from './local.js';
import { MockBackend } from './mock.js';

export function createBackend(name: BackendName): GenerateBackend {
  switch (name) {
    case 'fal':
      return new FalBackend();
    case 'local':
      return new LocalBackend();
    default:
      return new MockBackend();
  }
}
