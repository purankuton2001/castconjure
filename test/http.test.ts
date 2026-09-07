import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocalHostHeader } from '../src/server/http.js';

test('Host header guard accepts loopback hosts only (DNS rebinding)', () => {
  assert.equal(isLocalHostHeader('127.0.0.1:8787'), true);
  assert.equal(isLocalHostHeader('localhost:8787'), true);
  assert.equal(isLocalHostHeader('LOCALHOST'), true);
  assert.equal(isLocalHostHeader('[::1]:8787'), true);
  assert.equal(isLocalHostHeader('attacker.example:8787'), false);
  assert.equal(isLocalHostHeader('127.0.0.1.attacker.example'), false);
  assert.equal(isLocalHostHeader('localhost.attacker.example:8787'), false);
  assert.equal(isLocalHostHeader('192.168.1.10:8787'), false);
  assert.equal(isLocalHostHeader(''), false);
  assert.equal(isLocalHostHeader(undefined), false);
});
