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

export async function generateReply(req: ReplyRequest, signal?: AbortSignal): Promise<{ text: string; provider: string; ms: number }> {
  const t0 = Date.now();
  const max = req.persona.personality.replyMaxChars ?? 30;
  const system = req.persona.replySystemPrompt || defaultSystemPrompt(req.persona);
  const user = `視聴者「${req.author}」さんのコメント：「${req.comment}」\nこのコメントに応えて、これからその動作をする前の一言を ${max} 字以内で返してください。台詞のみを出力。`;
  const provider = secrets.replyProvider;
  let text: string;
  if (provider === 'anthropic') text = await anthropic(system, user, signal);
  else if (provider === 'gemini') text = await gemini(system, user, signal);
  else if (provider === 'openai') text = await openai(system, user, signal);
  else text = mock(req);
  return { text: clean(text, max), provider, ms: Date.now() - t0 };
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
