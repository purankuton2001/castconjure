<p align="center">
  <img src="docs/demo.gif" alt="castconjure — a viewer comment becomes a 5-second clip on the stream" width="820">
</p>

<h1 align="center">castconjure</h1>

<p align="center">
  <b>Your live chat becomes 5-second AI video clips — on the stream you already have.</b><br>
  Open-source, bring-your-own-key OBS overlay. You keep your camera, your game, your channel.
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
viewer comment ─► filter / select ─► prompt ─► generate ─► queue ─► OBS overlay
                  NG words            world +     fal H3 Max          "〇〇's comment"
                  real-person guard   character   (≈3 s / clip)       + "AI generated"
                  rate limit          comment     or local H3
                  approval mode       audio       or mock ($0)
```

A viewer types *"a cat surfing on a rainbow"*. Three seconds later a 5-second clip of exactly that fades in over your stream, tagged with their name. That's the whole product. Everything else exists to make it safe, cheap, and one-command to set up.

## Why this and not a fully generated stream

| | fal.live / Infinite Slop | Daydream / StreamDiffusion | **castconjure** |
|---|---|---|---|
| What's on screen | 100 % generated | your video, restyled frame-by-frame | **your stream, plus a clip when chat asks** |
| Who drives it | the crowd, all the time | you | **the streamer sets the world, viewers cast into it** |
| Cost model | 24/7 generation | GPU per frame | **event-driven, ~$0.25 per clip, hard budget cap** |
| Keys / data | theirs | yours | **yours — `.env` never leaves the machine** |
| Platform | Twitch | Twitch | **YouTube Live first (API key only, no OAuth)** |

castconjure is *insertion*, not *replacement*. Face-cam, gameplay, VTuber model — untouched. The generated moment is a garnish the audience controls, and the streamer can turn off with one click.

## Quick start

```bash
git clone https://github.com/purankuton2001/castconjure && cd castconjure
npm install
cp .env.example .env     # defaults: BACKEND=mock, PLATFORM=manual — nothing to fill in yet
npm start
```

1. Open **http://127.0.0.1:8787/** — the control panel.
2. In OBS add a **Browser** source: URL `http://127.0.0.1:8787/overlay`, 1920 × 1080, transparent background.
3. Press **▶ Start**, type anything into *Test comment*, hit Send. A card fades in on the overlay. The loop works.

Now make it real:

```bash
# .env
BACKEND=fal
FAL_KEY=…                      # from fal.ai/dashboard/keys — you pay fal directly
PLATFORM=youtube
YOUTUBE_API_KEY=…              # your own Google Cloud project, YouTube Data API v3, no OAuth
```

Start your stream, paste the video ID into the panel, press Start. Chat is live.

Smoke-test one clip without streaming (5 free generations/day on fal when signed in):

```bash
npm run gen:once -- "a tiny dragon sneezes and lights a birthday candle"
```

## How it works

```
src/
  chat/       ChatAdapter   youtube.ts   videos.list → liveChatMessages.list, honours pollingIntervalMillis
                            manual.ts    inject from the panel (testing, or hand-curated streams)
  filter/     ngfilter.ts   blocklist (ja/en) + real-person heuristics; blocked = silent, never taunt
              selector.ts   command prefix, global rate limit, per-user cooldown
  prompt/     builder.ts    world prompt (per stream) + character (fixed) + comment + audio hint
  backend/    GenerateBackend   fal.ts   H3 Max via fal queue REST (text-to-video / reference-to-video)
                                local.ts ComfyUI, templated API-format workflow (pre-generation mode)
                                mock.ts  $0 text card — the full loop with no keys
  queue/      pipeline.ts   pending_approval → queued → generating → ready → playing → done
                            per-session USD budget, clip caching, JSONL metrics
  server/     http.ts       panel, overlay, /api, WebSocket
public/       overlay.html  (OBS)   config.html  (panel)
```

Every layer is an interface. Twitch is one adapter file. Another model is one backend file. Nothing in the pipeline knows it's for entertainment streams — the same engine could run live commerce or a classroom.

### Overlay

`http://127.0.0.1:8787/overlay?pos=br&w=640&audio=1`

| param | values | |
|---|---|---|
| `pos` | `br` `bl` `tr` `tl` `c` | position (default bottom-right) |
| `w` | px | clip width (default 640) |
| `pad` | px | distance from edges (default 32) |
| `audio` | `1` | play with sound (enable "control audio via OBS") |
| `wait` | `0` | hide the "generating…" placeholder |

Shows: the clip, **who cast it** (`〇〇さんのコメント`), and an **AI generated** badge (on by default). Reconnects on its own; restart the server and OBS never notices.

### Panel

Everything below is live-editable mid-stream and persisted to `data/settings.json`.

| | |
|---|---|
| **World prompt** | the per-stream vibe: *"neon Tokyo, rain, 90s anime"* |
| **Character** | your own mascot: name, description, what it must never do, up to 3 reference images → reference-to-video |
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

Defaults are the cheapest route (480p, 5 s, 30 s interval) and a **$20 session cap**. Set a monthly cap on the fal dashboard too. The local backend is $0 and ~50 s per clip on an RTX 4090 — use it with a 90 s+ interval.

Every generation is logged with its estimated cost; the fal invoice is the source of truth.

## Safety

These are defaults. Keep them.

1. **No real people.** Names, honorifics (〇〇さん / ちゃん / くん), `@mentions`, "Firstname Lastname", titles (president, idol…) are dropped unconditionally. False positives are accepted; blocked comments get *no* on-screen reaction.
2. **Only your own character.** Don't put someone else's character, an existing IP, or a real face into reference images or descriptions. This line keeps the risk with the streamer, not with the project.
3. **Sexual / violent content** is double-filtered: the bundled list (`data/ng-words.txt`) plus the model's safety checker.
4. **The streamer is in charge.** On/off, world, rate, approval — viewers cannot paint on your screen without you.
5. **AI is disclosed.** The badge is on by default.

## Metrics

`data/logs/session-<timestamp>.jsonl`, one event per line. These are the numbers we publish after each demo stream.

| ev | fields |
|---|---|
| `comment_received` / `comment_filtered` | `reason` — `real_person` `ng_word` `url` `rate_limit` `user_cooldown` `queue_full` `budget_exhausted` |
| `comment_selected` | `job` `text` |
| `gen_start` / `gen_done` / `gen_failed` | `backend` `genMs` `sinceReceivedMs` `costUsd` `spentUsd` `expandedPrompt` |
| `play_start` / `play_end` | `sinceReceivedMs` — **comment → on screen** |
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
- [ ] Demo streams #1–#3 on [purankuton2001](https://www.youtube.com/@purankuton2001) with published latency/cost logs
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

**いま配信している画面を捨てずに、視聴者コメントを 5 秒の生成映像に変えて OBS へ差し込む、BYOK・MIT の個人配信者向け OSS オーバーレイ。**

- **差し込み型**：画面全体を AI にしない。顔出し・ゲーム・VTuber の既存配信に、コメント駆動の演出を部分的に足す
- **BYOK**：fal と YouTube の API キーは自分で発行して `.env` に置く。外に出ない。生成費用は自分の fal アカウントに直接課金
- **バックエンド切替**：`fal`（H3 Max、約 3 秒で 5 秒クリップ）/ `local`（ComfyUI、事前生成）/ `mock`（$0）
- **YouTube Live**：API キーのみ、OAuth 不要、審査不要

### 3 分で動かす

```bash
git clone https://github.com/purankuton2001/castconjure && cd castconjure
npm install && cp .env.example .env && npm start
```

1. <http://127.0.0.1:8787/> を開く
2. OBS に **ブラウザソース**：`http://127.0.0.1:8787/overlay`、1920 × 1080、背景透過
3. **▶ Start** → Test comment に一言 → Send。オーバーレイにカードが出れば一周

本物にするには `.env` に `BACKEND=fal` と `FAL_KEY`、`PLATFORM=youtube` と `YOUTUBE_API_KEY`。配信を始めてから動画 ID をパネルに入れて Start。

### 費用の目安

480p・5 秒で **1 クリップ $0.25**。30 秒に 1 回、60 分で約 $30。セッション上限（既定 $20）に達すると自動停止。キャラ参照画像を使う経路は $0.42 前後。

### 安全ルール

実在人物は生成しない（人名・敬称・@・肩書は無条件除外、誤検知は許容）。キャラは自分のものだけ。性的・暴力的表現は二重フィルタ。配信者が主導。「AI生成」表記は既定 ON。

### 配信中の運用

- **承認モード**：フィルタを通ったコメントは保留に並び、配信者かモデレーターの `!ok`（最新を承認）か UI の ✓ で生成。視聴者の `!ok` は黙って捨てる
- **`!gen` 縛り**：Command prefix に `!gen` を入れると、付いたコメントだけ拾う
- **予算**：ヘッダーに使用額が出る。到達で止まったら Reset budget

詳しい使い方ガイド：[docs/GUIDE.md](docs/GUIDE.md)
