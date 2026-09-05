import { secrets } from '../config.js';
import type { Persona } from '../types.js';

/**
 * F-14 reply mode: the persona answers a viewer in one short line. BYOK; provider chosen by REPLY_PROVIDER.
 * The line is later NG-filtered by the pipeline and, if blocked, replaced by the persona's safe fallback.
 */
export interface ReplyRequest {
  persona: Persona;
  author: string;
  comment: string;
}

/**
 * Returns the persona's one-line reply AND a concrete action for the video prompt ("director line"):
 * the comment "dance!!" becomes "she stands up and dances energetically…" so the clip actually shows it.
 */
export async function generateReply(req: ReplyRequest, signal?: AbortSignal): Promise<{ text: string; action: string; provider: string; ms: number }> {
  const t0 = Date.now();
  const max = req.persona.personality.replyMaxChars ?? 30;
  const system = req.persona.replySystemPrompt || defaultSystemPrompt(req.persona);
  const user = `視聴者「${req.author}」さんのコメント：「${req.comment}」
2 行で出力してください。
REPLY: そのコメントに応える、これから動く前の一言（${max} 字以内、コメントと同じ言語、絵文字なし）
ACTION: 映像に映す具体的な動作を英語 1〜2 文で（体全体の動き、表情、必要なら立ち上がる。実在人物・既存作品・楽曲名は書かない）`;
  const provider = secrets.replyProvider;
  let text: string, action: string;
  if (provider === 'mock') {
    text = mock(req);
    action = directAction(req.comment);
  } else {
    const raw = provider === 'anthropic' ? await anthropic(system, user, signal) : provider === 'gemini' ? await gemini(system, user, signal) : await openai(system, user, signal);
    const m = /REPLY:\s*(.+)/i.exec(raw);
    const a = /ACTION:\s*(.+)/i.exec(raw);
    text = m?.[1] ?? raw.split('\n')[0];
    action = a?.[1]?.trim() || directAction(req.comment);
  }
  return { text: clean(text, max), action, provider, ms: Date.now() - t0 };
}

/** Keyword director (used by the mock provider and as a fallback): comment → explicit full-body action. */
export function directAction(comment: string): string {
  const c = comment.toLowerCase();
  const table: [RegExp, string][] = [
    [/dance|踊|춤|dança|baila/, 'She springs up from the floor and dances energetically in the middle of the room — full-body movement, hips and arms swinging to an upbeat rhythm, spinning once, hair flying, big grin.'],
    [/sing|歌|노래/, 'She stands up, holds an imaginary microphone and sings passionately with her whole body, eyes closed on the high note, then laughs.'],
    [/jump|ジャンプ|跳|점프/, 'She jumps up and down excitedly with both arms in the air, hair bouncing.'],
    [/wave|手を振|손 흔들|hi\b|hello|こんにちは|안녕/, 'She waves at the camera with both hands, leaning in with a wide smile.'],
    [/eat|食べ|먹|ramen|ラーメン|라면|pizza|cake/, 'She grabs a bowl, slurps noodles enthusiastically, cheeks puffed, then gives a thumbs up.'],
    [/drink|飲|마셔|coffee|tea/, 'She picks up her mug, takes a big sip, sighs happily and hugs the mug.'],
    [/laugh|笑|웃/, 'She bursts out laughing, doubling over and slapping her knee.'],
    [/cry|泣|울/, 'She pretends to cry dramatically, wiping fake tears, then peeks and giggles.'],
    [/spin|回|돌/, 'She stands and twirls around twice with her arms out, then strikes a pose.'],
    [/sleep|寝|자/, 'She yawns, curls up on the cushion and pretends to fall asleep, then peeks one eye open.'],
    [/peace|ピース|브이/, 'She leans in close to the camera and flashes a double peace sign, winking.'],
    [/heart|ハート|하트/, 'She makes a big heart with her arms over her head, then a small finger heart at the camera.'],
    [/run|走|달려/, 'She jumps up and runs in place at full speed, arms pumping, then stops out of breath and laughs.'],
    [/stretch|伸び/, 'She stretches her arms high, arches her back, and shakes it out.'],
    [/cook|料理|요리/, 'She mimes cooking at a stove, tossing a pan dramatically and tasting with a wooden spoon.'],
    [/beach|海|바다/, 'She is now standing on a sunset beach, wind in her hair, arms spread wide, laughing at the waves.'],
  ];
  for (const [re, a] of table) if (re.test(c)) return a;
  return `She acts out the request "${comment}" with her whole body, expressively, standing up if it helps.`;
}

function mock(req: ReplyRequest): string {
  // Language follows the comment (Hangul → ko, kana/kanji → ja, else en), like a real LLM reply would.
  if (/[\uac00-\ud7a3]/.test(req.comment)) return `${req.author}, 해보자!`;
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(req.comment)) {
    const tics = req.persona.personality.verbalTics?.length ? req.persona.personality.verbalTics : ['やってみよ！'];
    return `${req.author}さん、${tics[Math.floor(Math.random() * tics.length)]}`;
  }
  return `${req.author}, let's do it!`;
}

function clean(s: string, max: number): string {
  let t = s.trim().replace(/^["「『]+|["」』]+$/g, '').replace(/\s+/g, ' ');
  if ([...t].length > max) t = [...t].slice(0, max).join('') ;
  return t;
}

export function defaultSystemPrompt(p: Persona): string {
  const tics = (p.personality.verbalTics ?? []).map((t) => `「${t}」`).join('');
  return [
    `あなたは「${p.name}」。ファン（${p.fanName ?? '視聴者'}）のコメントに応えて動く配信者で、自分が AI で生成されていることを隠さない。`,
    p.personality.principle ? `主義：${p.personality.principle}。` : '',
    p.personality.tone ? `話し方：${p.personality.tone}。` : '',
    tics ? `口癖：${tics}。` : '',
    `返事は ${p.personality.replyMaxChars ?? 30} 字以内の一言。絵文字は使わない。相手は「〇〇さん」と呼ぶ。`,
    p.personality.distance ? `${p.personality.distance}。` : '',
    `次の話題には触れず、軽くそらして自分の動作に戻す：${p.forbidden.join('、') || '性的・暴力的・政治・宗教・実在人物'}。`,
    '相手のコメントと同じ言語で返す（英語なら英語、韓国語なら韓国語）。「AI ではない」とは言わない。出力は台詞のみ。',
  ]
    .filter(Boolean)
    .join('');
}

async function anthropic(system: string, user: string, signal?: AbortSignal): Promise<string> {
  if (!secrets.anthropicKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': secrets.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: secrets.replyModel || 'claude-haiku-4-5-20251001', max_tokens: 120, system, messages: [{ role: 'user', content: user }] }),
    signal,
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { content?: { type: string; text?: string }[] };
  return j.content?.find((c) => c.type === 'text')?.text ?? '';
}

async function gemini(system: string, user: string, signal?: AbortSignal): Promise<string> {
  if (!secrets.geminiKey) throw new Error('GEMINI_API_KEY is not set');
  const model = secrets.replyModel || 'gemini-2.5-flash';
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${secrets.geminiKey}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: 120 } }),
    signal,
  });
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
}

async function openai(system: string, user: string, signal?: AbortSignal): Promise<string> {
  if (!secrets.openaiKey) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secrets.openaiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: secrets.replyModel || 'gpt-4o-mini', max_tokens: 120, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal,
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return j.choices?.[0]?.message?.content ?? '';
}
