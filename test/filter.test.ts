import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NgFilter, looksLikeRealPerson } from '../src/filter/ngfilter.js';
import { Selector } from '../src/filter/selector.js';
import { buildIdlePrompt, buildPrompt } from '../src/prompt/builder.js';
import { defaultSystemPrompt, generateReply } from '../src/reply/llm.js';
import { defaultSettings } from '../src/config.js';
import type { ChatMessage, Persona } from '../src/types.js';

const ng = new NgFilter();

test('ng filter blocks built-in words, urls, and real-person heuristics', () => {
  assert.equal(ng.check('猫がサーフィンしてる', [], 120), null);
  assert.equal(ng.check('a cat surfing on a rainbow', [], 120), null);
  assert.equal(ng.check('エロい猫', [], 120), 'ng_word');
  assert.equal(ng.check('NSFW please', [], 120), 'ng_word');
  assert.equal(ng.check('see https://example.com', [], 120), 'url');
  assert.equal(ng.check('田中さんが踊る', [], 120), 'real_person');
  assert.equal(ng.check('Taylor Swift dancing', [], 120), 'ip'); // listed idol wins over the name heuristic
  assert.equal(ng.check('Emily Carter dancing', [], 120), 'real_person');
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

const persona: Persona = {
  id: 'yui', name: '白詰 ゆい', nameEn: 'Yui', adult: true, fanName: 'クローバー',
  appearance: { summary: 'a Japanese woman in her early twenties', signatures: ['clover hair pin'] },
  references: {}, personality: { verbalTics: ['やってみよ！'], replyMaxChars: 30 }, forbidden: ['weapons'],
  worldPrompt: 'Cozy apartment at golden hour.',
};

test('prompt builder composes world + persona + comment + reply + audio', () => {
  const s = { ...defaultSettings(), worldPrompt: '', audio: true };
  const p = buildPrompt({ comment: 'a cat "surfing"\nnow', reply: 'やってみよ！', refCount: 3, hasVoice: true }, s, persona);
  assert.match(p, /^Cozy apartment at golden hour\./);
  assert.match(p, /"Yui" \(appearance exactly as in Image 1, outfit as in Image 2, setting as in Image 3\): a Japanese woman/);
  assert.match(p, /Always visible: clover hair pin/);
  assert.match(p, /Never: weapons/);
  assert.match(p, /"a cat 'surfing' now"/);
  assert.match(p, /She says, in Japanese.*"やってみよ！" — her voice matches Audio 1/);
  assert.match(p, /no minors/);
  // per-stream world prompt overrides the persona's
  assert.match(buildPrompt({ comment: 'x', refCount: 0, hasVoice: false }, { ...s, worldPrompt: 'Neon Tokyo.' }, persona), /^Neon Tokyo\./);
});

test('idle prompt loops and has no comment', () => {
  const p = buildIdlePrompt(1, { ...defaultSettings(), worldPrompt: '' }, persona, 3);
  assert.match(p, /adjusts her hair pin/);
  assert.match(p, /so the clip loops/);
  assert.doesNotMatch(p, /viewer's comment/);
});

test('reply mock + default system prompt', async () => {
  const r = await generateReply({ persona, author: 'taro', comment: '踊って' });
  assert.equal(r.provider, 'mock');
  assert.match(r.text, /^taroさん、/);
  assert.equal((await generateReply({ persona, author: 'mika', comment: 'dance!!' })).text, "mika, let's do it!");
  assert.equal((await generateReply({ persona, author: 'yujin', comment: '춤춰줘' })).text, 'yujin, 해보자!');
  assert.ok([...r.text].length <= 30);
  assert.match(defaultSystemPrompt(persona), /白詰 ゆい/);
});

test('ng filter: allowNames skips the honorific heuristic but keeps the blocklist', () => {
  assert.equal(ng.check('taroさん、やってみよ！', [], 200, { allowNames: true }), null);
  assert.equal(ng.check('taroさん、やってみよ！', [], 200), 'real_person');
  assert.equal(ng.check('taroさん、エロいね', [], 200, { allowNames: true }), 'ng_word');
});

test('ip guard (F-16): real idols, groups, anime characters, likeness and choreo requests', () => {
  assert.equal(ng.check('dance like Jennie', [], 200), 'ip');
  assert.equal(ng.check('BTS dance please', [], 200), 'ip');
  assert.equal(ng.check('뉴진스 춤 춰줘', [], 200), 'ip');
  assert.equal(ng.check('初音ミクの格好して', [], 200), 'ip');
  assert.equal(ng.check('cosplay as Nezuko', [], 200), 'ip');
  assert.equal(ng.check('do the choreo from that song', [], 200), 'ip');
  assert.equal(ng.check('Jennieに似せて', [], 200), 'ip');
  // word boundaries: "give" must not hit IVE, "power" alone is fine only as a word
  assert.equal(ng.check('give me a wave', [], 200), null);
  assert.equal(ng.check('dance!!', [], 200), null);
  assert.equal(ng.check('eat ramen', [], 200), null);
  assert.equal(ng.check("let's go to the beach", [], 200), null);
  assert.ok(ng.ip.size > 200);
});

test('prompt builder: anime style line', () => {
  const s = { ...defaultSettings(), worldPrompt: '' };
  assert.match(buildPrompt({ comment: 'x', refCount: 0, hasVoice: false }, s, { ...persona, style: 'anime' }), /2D anime style/);
  assert.match(buildPrompt({ comment: 'x', refCount: 0, hasVoice: false }, s, persona), /Photoreal/);
});
