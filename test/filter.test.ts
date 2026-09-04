import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NgFilter, looksLikeRealPerson } from '../src/filter/ngfilter.js';
import { Selector } from '../src/filter/selector.js';
import { buildPrompt } from '../src/prompt/builder.js';
import { defaultSettings } from '../src/config.js';
import type { ChatMessage } from '../src/types.js';

const ng = new NgFilter();

test('ng filter blocks built-in words, urls, and real-person heuristics', () => {
  assert.equal(ng.check('猫がサーフィンしてる', [], 120), null);
  assert.equal(ng.check('a cat surfing on a rainbow', [], 120), null);
  assert.equal(ng.check('エロい猫', [], 120), 'ng_word');
  assert.equal(ng.check('NSFW please', [], 120), 'ng_word');
  assert.equal(ng.check('see https://example.com', [], 120), 'url');
  assert.equal(ng.check('田中さんが踊る', [], 120), 'real_person');
  assert.equal(ng.check('Taylor Swift dancing', [], 120), 'real_person');
  assert.equal(ng.check('@someone hi', [], 120), 'real_person');
  assert.equal(ng.check('大統領が来る', [], 120), 'ng_word');
  assert.equal(ng.check('x'.repeat(200), [], 120), 'too_long');
  assert.equal(ng.check('banana', ['banana'], 120), 'ng_word');
  assert.equal(ng.check('   ', [], 120), 'empty');
});

test('real-person heuristic', () => {
  assert.equal(looksLikeRealPerson('a cat surfing'), false);
  assert.equal(looksLikeRealPerson('ドラゴンが空を飛ぶ'), false);
  assert.equal(looksLikeRealPerson('山田くん'), true);
});

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', platform: 'manual', authorName: 'a', authorId: 'u1', text: 'hello world',
  publishedAt: 0, receivedAt: 0, isModerator: false, isOwner: false, ...over,
});

test('selector: prefix, rate limit, user cooldown', () => {
  const s = { ...defaultSettings(), minIntervalSec: 30, userCooldownSec: 120, commandPrefix: '!gen' };
  const sel = new Selector(); const T = 1_000_000_000_000;
  assert.deepEqual(sel.consider(msg(), s, T + 1000), { ok: false, reason: 'no_command_prefix' });
  assert.deepEqual(sel.consider(msg({ text: "!gen a dog" }), s, T + 1000), { ok: true, text: 'a dog' });
  sel.markAccepted(msg(), T + 1000);
  assert.deepEqual(sel.consider(msg({ text: '!gen x', authorId: 'u2' }), s, T + 5000), { ok: false, reason: 'rate_limit' });
  assert.deepEqual(sel.consider(msg({ text: '!gen x', authorId: 'u2' }), s, T + 40000), { ok: true, text: 'x' });
  assert.deepEqual(sel.consider(msg({ text: '!gen x', authorId: 'u1' }), s, T + 40000), { ok: false, reason: 'user_cooldown' });
  assert.deepEqual(sel.consider(msg({ text: '!gen x', authorId: 'u1', isOwner: true }), s, T + 40000), { ok: true, text: 'x' });
});

test('prompt builder composes world + character + comment + audio', () => {
  const s = { ...defaultSettings(), worldPrompt: 'Neon Tokyo.', audio: true, character: { name: 'Plankton', description: 'a blue blob', forbidden: 'hold weapons', referenceImages: [] } };
  const p = buildPrompt('a cat "surfing"\nnow', s, true);
  assert.match(p, /^Neon Tokyo\./);
  assert.match(p, /"Plankton" \(appearance exactly as in Image 1\): a blue blob\./);
  assert.match(p, /must never: hold weapons/);
  assert.match(p, /"a cat 'surfing' now"/);
  assert.match(p, /ambient sound/);
  assert.match(p, /No real people/);
});
