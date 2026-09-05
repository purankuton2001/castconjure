<p align="center">
  <img src="docs/demo.gif" alt="castconjure — chat says dance, the generated persona dances" width="820">
</p>

<h1 align="center">castconjure</h1>

<p align="center">
  <b>Photoreal AI VTubers. Generated, not lip-synced.</b><br>
  Conjure a face once. Your chat makes her dance, eat, talk and change scenes — live, in any language your fans speak.<br>
  Built for the K-pop / anime fandom era: one idol, a global chat, no modelling, no rigging. Open source, bring your own key.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-7c5cff"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-3ecf8e">
  <img alt="backend" src="https://img.shields.io/badge/backend-fal%20H3%20Max%20%7C%20local%20ComfyUI%20%7C%20mock-1f2230">
  <img alt="chat" src="https://img.shields.io/badge/chat-YouTube%20Live-ff0000">
  <img alt="status" src="https://img.shields.io/badge/status-MVP%20%C2%B7%20demo%20streams%20in%20progress-f5a623">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#cost">Cost</a> ·
  <a href="#safety">Safety</a> ·
  <a href="#日本語">日本語</a>
</p>

---

```
 create once      face gacha ─► reference set (face / full / scene) ─► TTS voice ─► personality ─► idle pool
                  (generated in-app only — there is no photo upload, by design)

 live             idle loop ◄──────────────────────────────────────────────────────────────────┐
                  viewer comment ─► filter ─► (reply: LLM one-liner) ─► prompt ─► H3 Max r2v ─► reaction clip
                                    NG words / real-person guard / rate / approval          "〇〇's comment" + subtitle + "AI generated"
```

A viewer types *"dance!!"*. The persona — a face you generated ten minutes ago — answers *"taro_k, let's do it!"* and dances, on your stream, three seconds later. Someone in Seoul types *"언니 춤춰요"* and gets the same idol answering in Korean. Lip-sync avatars move a mouth; castconjure generates the whole shot: action, outfit, camera, scene.

## Puppet vs. actor

| | Live2D / lip-sync avatars (HeyGen, Hedra, AITuber rigs) | fal.live / Infinite Slop | **castconjure** |
|---|---|---|---|
| What moves | mouth and head | everything, no fixed persona | **the persona does what chat asks: dance, eat, cry, change outfit, change room** |
| Camera | fixed webcam framing | generated | **generated: close-ups, pans, 35 mm look** |
| Consistency | a rigged model | none | **3 reference images + reference voice (+ signatures)** |
| To create one | modelling + rigging, weeks | — | **face gacha → 3 refs → voice → personality: ~10 minutes** |
| Cost | GPU / subscription | 24/7 generation | **idle pool pre-generated, reaction clips ≈ $0.46 each, hard budget cap** |
| Keys / data | theirs | theirs | **yours — `.env` never leaves the machine** |

Two layers keep her "always there" without paying for continuous generation: a pre-generated **idle pool** loops underneath; a **reaction clip** is generated only when a comment is cast and crossfades on top.

## Quick start

```bash
git clone https://github.com/purankuton2001/castconjure && cd castconjure
npm install
cp .env.example .env     # defaults: BACKEND=mock, PLATFORM=manual — nothing to fill in yet
npm start
```

1. Open **http://127.0.0.1:8787/** — the control panel. The bundled persona **白詰ゆい** is selected.
2. **Persona → 顔ガチャ**: draw 4 faces (mock = placeholder portraits, fal = photoreal), click one → full-body and in-scene references are derived. Confirm. Generate a **voice**. Generate the **idle pool**.
3. In OBS add a **Browser** source: URL `http://127.0.0.1:8787/overlay`, 1920 × 1080. The idle loop is already playing.
4. Press **▶ Start**, type *踊って* into *Test comment*, hit Send. She answers and a reaction clip crossfades in. The loop works.

Now make it real:

```bash
# .env
BACKEND=fal
FAL_KEY=…                      # from fal.ai/dashboard/keys — you pay fal directly
PLATFORM=youtube
YOUTUBE_API_KEY=…              # your own Google Cloud project, YouTube Data API v3, no OAuth
```

Start your stream, paste the video ID into the panel, press Start. Chat is live.

Smoke-test one clip without streaming (5 free generations/day on fal when signed in), or run the week-1 consistency probe (N clips + an HTML contact sheet to rate face consistency 1–5):

```bash
npm run gen:once -- "手を振って"
npm run probe -- --n 20
```

## How it works

```
src/
  persona/    store.ts      a persona is a folder: data/personas/<id>/{persona.json, refs/, voice.*, idle/}
              facegen.ts    F-10 face gacha (fal FLUX / Kontext, or mock) — generation only, no upload path
              voice.ts      F-11 TTS reference voice (never cloned from a real person)
  reply/      llm.ts        F-14 one-line reply in the persona's voice (mock | anthropic | gemini | openai, BYOK)
  chat/       ChatAdapter   youtube.ts   videos.list → liveChatMessages.list, honours pollingIntervalMillis
                            manual.ts    inject from the panel (testing, or hand-curated streams)
  filter/     ngfilter.ts   blocklist (ja/en) + real-person heuristics; blocked = silent, never taunt
              selector.ts   command prefix, global rate limit, per-user cooldown
  prompt/     builder.ts    world (per stream → persona default) + persona (Image 1/2/3, Audio 1) + comment + reply
  backend/    GenerateBackend   fal.ts   H3 Max via fal queue REST (text-to-video / reference-to-video + reference audio)
                                local.ts ComfyUI, templated API-format workflow (pre-generation mode)
                                mock.ts  $0 text card — the full loop with no keys
  queue/      pipeline.ts   idle pool (F-13) · pending_approval → queued → generating → ready → playing → done
                            per-session USD budget, clip caching, JSONL metrics, consistency ratings
  server/     http.ts       panel, overlay, /api, /personas static, WebSocket
personas/     shirotsume-yui/persona.json   bundled persona template (seeded into data/personas on first boot)
public/       overlay.html  two layers: idle loop (two <video>s crossfading) + reaction clip with subtitle
```

Every layer is an interface. Twitch is one adapter file. Another model is one backend file. A persona is a folder you can copy to another machine. The reply LLM answers in the commenter's language, so one persona serves an English, Korean and Japanese chat at once. Nothing in the pipeline knows it's for fandom — the same engine could front live commerce or a classroom.

### Overlay

`http://127.0.0.1:8787/overlay?pos=full&audio=1`

| param | values | |
|---|---|---|
| `pos` | `full` `br` `bl` `tr` `tl` `c` | full-screen persona (default) or a framed window |
| `w` | px | window width when not full (default 960) |
| `idle` | `0` | disable the idle layer (reaction clips only, v0.6 behaviour) |
| `pad` | px | distance from edges (default 32) |
| `audio` | `1` | play with sound (enable "control audio via OBS") |
| `wait` | `0` | hide the "generating…" placeholder |

Shows: the idle loop, the reaction clip on top, **who cast it** (`〇〇さんのコメント`), the persona's **reply as a subtitle**, and an **AI generated** badge (on by default). Reconnects on its own; restart the server and OBS never notices.

### Panel

Everything below is live-editable mid-stream and persisted to `data/settings.json`.

| | |
|---|---|
| **Persona** | select / create; face gacha → reference set → confirm; voice; personality (name, fan name, appearance, signatures, tone, verbal tics, forbidden, reply system prompt); idle pool |
| **World prompt** | the per-stream vibe, overriding the persona's default: *"rainy neon Tokyo rooftop"* |
| **Reply mode** | an LLM answers each cast comment in one line (≤ 30 chars); it becomes her spoken line and the subtitle |
| **Min interval / User cooldown** | one clip per N seconds; one per viewer per M seconds |
| **Command prefix** | `!gen` — only prefixed comments count; empty = every comment |
| **Approval mode** | nothing generates until you or a moderator says `!ok` (or click ✓) |
| **Budget per session** | hard stop in USD; reset from the panel |
| **Extra NG words** | your name, your channel, topics you don't want |

## Cost

fal pricing for MiniMax H3 Max, checked 2026-09 (the launch discount ended Sept 1):

| route | per second | 5-s clip | 60 min at one clip / 30 s |
|---|---|---|---|
| text-to-video 480p | $0.05 | **$0.25** | ≈ $30 |
| text-to-video 768p | $0.08 | $0.40 | ≈ $48 |
| reference-to-video (character images) | $0.08 + $0.02 / image | $0.42 – 0.46 | ≈ $50 – 55 |

With the persona's 3 reference images every reaction clip takes the reference-to-video route: **≈ $0.46** at 5 s. The **idle pool** (12 × 5 s ≈ $5.50, or $0 on the local backend) is generated once per persona and loops for free. Defaults: 480p, 5 s, 30 s interval, **$20 session cap**. Set a monthly cap on the fal dashboard too.

Every generation is logged with its estimated cost; the fal invoice is the source of truth.

## Safety

These are defaults. Keep them.

1. **Faces are generated in-app only.** There is no upload. Every face prompt carries a fixed suffix: fictional adult, not resembling any real celebrity. Don't work around it with `.env` paths unless the image is one you generated yourself.
2. **No real people in comments either.** Names, honorifics (〇〇さん / ちゃん / くん), `@mentions`, "Firstname Lastname", titles (president, idol…) are dropped unconditionally. False positives are accepted; blocked comments get *no* on-screen reaction.
3. **Adults only.** The persona is an adult by definition; childlike appearance or behaviour is on the forbidden list.
4. **Voice is TTS.** Never cloned from a real person.
5. **Sexual / violent content** is double-filtered: the bundled list (`data/ng-words.txt`) plus the model's safety checker. Reply lines go through the same filter.
6. **The owner is in charge.** On/off, world, rate, approval, reply mode — viewers cannot paint on your screen without you.
7. **AI is disclosed.** The badge is on by default; label the stream as synthetic content on YouTube.

## Metrics

`data/logs/session-<timestamp>.jsonl`, one event per line. These are the numbers we publish after each demo stream.

| ev | fields |
|---|---|
| `comment_received` / `comment_filtered` | `reason` — `real_person` `ng_word` `url` `rate_limit` `user_cooldown` `queue_full` `budget_exhausted` |
| `comment_selected` | `job` `text` |
| `gen_start` / `gen_done` / `gen_failed` | `backend` `genMs` `sinceReceivedMs` `costUsd` `spentUsd` `expandedPrompt` |
| `play_start` / `play_end` | `sinceReceivedMs` — **comment → on screen** |
| `reply_done` / `reply_failed` | `provider` `ms` `blocked` |
| `gacha` / `refs_derived` / `voice_generated` / `idle_pool_start` / `idle_clip_done` | persona creation costs |
| `consistency_rating` | the owner's 1–5 face-consistency rating from the panel (week-1 metric) |
| `youtube_poll` | `items` `pollingIntervalMillis` `estUnits` |

```bash
# median comment→screen latency (ms)
grep '"ev":"play_start"' data/logs/session-*.jsonl | jq -s 'map(.sinceReceivedMs) | sort | .[length/2|floor]'
```

Target on the fal route: **under 15 s** comment-to-screen. H3 Max itself returns a 5-s clip in about 3 s; the rest is transfer and queueing.

## Local backend (ComfyUI)

1. Build your H3 workflow in ComfyUI, **Save (API Format)**.
2. Copy it to `local/workflow.json` and replace the literal values with `{{PROMPT}}` `{{FRAMES}}` `{{RESOLUTION}}` `{{SEED}}` `{{REFERENCE_IMAGE}}` — see `local/workflow.example.json`.
3. `.env`: `BACKEND=local`, `COMFY_URL=http://127.0.0.1:8188`.

The output node must write mp4/webm (e.g. `VHS_VideoCombine`).

## Roadmap

- [x] YouTube Live (API key), fal H3 Max, local ComfyUI, mock
- [x] NG filter, real-person guard, approval mode, budget cap, JSONL metrics
- [x] Persona: face gacha, reference set, TTS voice, personality, idle pool, reply mode, two-layer overlay
- [ ] Week-1 probe: face consistency with 3 refs; spoken lines + reference voice through fal H3 Max
- [ ] Demo streams #1–#3 with 白詰ゆい on [purankuton2001](https://www.youtube.com/@purankuton2001), published latency/cost logs
- [ ] Gift → directing rights (outfit change, scene change, close-up)
- [ ] Twitch adapter
- [ ] Last-frame → first-frame continuity between clips
- [ ] Mic input as a trigger (Web Speech / Whisper)
- [ ] Character LoRA for the local route
- [ ] Docker

Not planned: monetisation, a generic H3 SDK, 24/7 infinite streams, frame-level world models.

## Development

```bash
npm run dev          # tsx watch
npm test             # filter / selector / prompt tests
npm run typecheck
python3 scripts/demo-video.py            # render the demo video (mock clips)
python3 scripts/demo-video.py --clips data/clips/a.mp4,data/clips/b.mp4   # with real clips
```

## License

MIT. Generation costs are billed to *your* fal account; this project neither pays nor proxies.

---

## 日本語

**誰でも 10 分でフォトリアルな AI VTuber（推し）を作り、リップシンクではなく映像そのものを生成して配信に載せる OSS。** 主戦場は英語圏・韓国語圏の K-pop／アニメ系ファンダムで、日本語はここに要点だけ。詳しくは上の英語版と [docs/GUIDE.md](docs/GUIDE.md)。

- **人形ではなく俳優**：口パクではなく、踊る・食べる・喋る・場所を変える。動作・衣装・カメラが毎クリップ変わる
- **顔はアプリ内で生成したものだけ**：写真アップロードはない。架空の成人、実在人物に似せない指示が常に付く
- **二層で「常時いる」**：待機映像プールをループし、コメントが来たときだけ反応クリップを生成して重ねる
- **BYOK・MIT**：fal / YouTube / LLM のキーは自分のもの。費用は自分のアカウントに直接
- **YouTube Live**：API キーのみ、OAuth 不要

### 3 分で動かす

```bash
git clone https://github.com/purankuton2001/castconjure && cd castconjure
npm install && cp .env.example .env && npm start
```

1. <http://127.0.0.1:8787/> を開く。同梱の推し **白詰ゆい** が選ばれている
2. **推し → 顔ガチャ** で 4 枚引き、気に入った顔をクリック → 全身・世界観の参照を派生生成 → 確認して保存 → **声を生成** → **待機映像プールを生成**
3. OBS に **ブラウザソース**：`http://127.0.0.1:8787/overlay`、1920 × 1080。待機映像が流れ始める
4. **▶ Start** → Test comment に「踊って」→ Send。推しが一言返し、反応クリップが重なれば一周

本物にするには `.env` に `BACKEND=fal` と `FAL_KEY`、`PLATFORM=youtube` と `YOUTUBE_API_KEY`。配信を始めてから動画 ID をパネルに入れて Start。

### 費用の目安

参照画像 3 枚の reference-to-video で **1 クリップ約 $0.46**。30 秒に 1 回、60 分で約 $55。待機プールは 12 本で約 $5.5（ローカルなら $0）、推しごとに 1 回だけ。セッション上限（既定 $20）に達すると反応だけ止まり、待機は流れ続ける。

### 安全ルール

顔はアプリ内生成のみ（写真不可）。実在人物は生成しない（人名・敬称・@・肩書は無条件除外）。推しは成人のみ。声は TTS のみ。性的・暴力的表現は二重フィルタで、返事の台詞にもかける。持ち主が主導。「AI生成」表記は既定 ON、YouTube の合成コンテンツ開示も。

### 配信中の運用

- **承認モード**：フィルタを通ったコメントは保留に並び、配信者かモデレーターの `!ok`（最新を承認）か UI の ✓ で生成。視聴者の `!ok` は黙って捨てる
- **`!gen` 縛り**：Command prefix に `!gen` を入れると、付いたコメントだけ拾う
- **予算**：ヘッダーに使用額が出る。到達で止まったら Reset budget

詳しい使い方ガイド：[docs/GUIDE.md](docs/GUIDE.md)
