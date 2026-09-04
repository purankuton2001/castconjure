# castconjure

**Turn your live chat into 5-second AI video clips on the stream you already have.**
An open-source, bring-your-own-key OBS overlay. You keep your camera, your game, your channel — viewer comments get *cast* into short generated clips (MiniMax H3 Max via fal, or open-weights H3 locally) and *conjured* onto your screen.

いま配信している画面を捨てずに、視聴者コメントを5秒の生成映像に変えて OBS へ差し込む、BYOK・MIT の個人配信者向け OSS オーバーレイ。

```
viewer comment → filter / select → prompt → generate (fal H3 Max | local H3) → queue → OBS overlay
                                                                                   └ "〇〇さんのコメント" を表示
```

- **差し込み型**：画面全体を AI にしない。既存配信にコメント駆動の演出を部分的に足す
- **BYOK / MIT**：fal の API キーも YouTube の API キーも自分で発行し、`.env` に置く。外に出ない。生成費用は自分の fal アカウントに直接課金
- **バックエンド切替**：`fal`（H3 Max、リアルタイム）/ `local`（ComfyUI、事前生成）/ `mock`（$0 のテキストカード）
- **YouTube Live 対応**（API キーのみ、OAuth 不要）。Twitch はアダプタを足すだけ

## Quick start

```bash
git clone https://github.com/purankuton/castconjure && cd castconjure
npm install
cp .env.example .env      # まずは BACKEND=mock / PLATFORM=manual のままで OK
npm start
```

1. ブラウザで <http://127.0.0.1:8787/> を開く（設定 UI）
2. OBS に **ブラウザソース** を追加：URL `http://127.0.0.1:8787/overlay`、幅 1920 × 高 1080、「背景を透過」
3. 設定 UI で **▶ Start** → 「Test comment」に何か入れて Send → 数秒後にオーバーレイにカードが出る

これでループが動くことを確認したら `.env` の `BACKEND=fal` と `FAL_KEY` を設定して本物の映像に切り替えます。

### Overlay URL options

`/overlay?pos=br&w=640&pad=32&audio=1&wait=0&accent=%237c5cff`

| param | 値 | 意味 |
|---|---|---|
| `pos` | `br` `bl` `tr` `tl` `c` | 表示位置（既定：右下） |
| `w` | px | クリップ幅（既定 640） |
| `audio` | `1` | 音声ありで再生（OBS 側で「音声をコントロール」を ON に） |
| `wait` | `0` | 生成中プレースホルダを出さない |

## Setup: fal (H3 Max)

1. <https://fal.ai> でキーを発行し `.env` の `FAL_KEY` に入れる
2. `BACKEND=fal`
3. fal のダッシュボードで **月次支出上限** も設定しておく（本ツールのセッション上限と二重にする）

単価（2026-09 時点、fal 公式）：

| 経路 | 単価 | 5秒クリップ |
|---|---|---|
| text-to-video 480p | $0.05/秒 | $0.25 |
| text-to-video 768p | $0.08/秒 | $0.40 |
| reference-to-video（キャラ参照画像あり） | $0.08/秒 + $0.02/枚 | $0.42〜0.46 |

30秒間隔で60分回すと約 $30〜55。`BUDGET_USD`（セッション上限）に達すると生成を止めます。

単発の動作確認：

```bash
npm run gen:once -- "a tiny dragon sneezes and lights a birthday candle"
```

## Setup: YouTube Live

OAuth は使いません。公開配信のライブチャットは API キーだけで読めます。

1. Google Cloud でプロジェクトを作り **YouTube Data API v3** を有効化 → 認証情報 → API キー
2. `.env` に `YOUTUBE_API_KEY=...`、`PLATFORM=youtube`
3. 配信を開始したら、設定 UI に **動画 ID**（URL の `v=`）を入れて Save → Start

クォータは 1 プロジェクト 1 日 10,000 unit（太平洋時間 0 時リセット）。castconjure は API が返す `pollingIntervalMillis` より速くはポーリングしません。設定 UI と JSONL ログにポーリング回数と unit 推定値（`YOUTUBE_UNITS_PER_POLL`、既定 5）を出すので、Google Cloud コンソールの実測値と突き合わせて README に追記予定。

## Setup: local (ComfyUI)

1. ComfyUI に H3（オープンウェイト）のワークフローを組み、**Save (API Format)** で JSON を書き出す
2. `local/workflow.example.json` を参考に、プロンプト等を `{{PROMPT}}` `{{FRAMES}}` `{{RESOLUTION}}` `{{SEED}}` `{{REFERENCE_IMAGE}}` に置き換えて `local/workflow.json` に保存
3. `.env` に `BACKEND=local`、`COMFY_URL=http://127.0.0.1:8188`

RTX 4090 で5秒クリップ約50秒。リアルタイムではなく「事前生成モード」。レート制限を長めに（`MIN_INTERVAL_SEC=90` など）。

## Settings

設定 UI（`/`）で変更でき、`data/settings.json` に保存されます。`.env` は初期値です。

| 項目 | 内容 |
|---|---|
| World prompt | 配信ごとに変える世界観 |
| Character | 固定のキャラ：名前・説明・禁止事項・参照画像（`data/characters/` のファイル名または URL、最大3枚） |
| Min interval / User cooldown | 全体レート制限 / 同一ユーザーの連投抑制 |
| Command prefix | `!gen` などを付けたコメントだけ拾う（空なら全部） |
| Approval mode | 配信者・モデレーターが `!ok`（最新の保留を承認）か UI の ✓ で通したものだけ生成 |
| Extra NG words | 配信者独自の禁止語 |
| Budget | セッション上限（USD）。到達で自動停止、UI から Reset |
| AI badge | 「AI生成」表記（既定 ON） |

## Safety rules (defaults you should keep)

1. **実在人物は生成しない**。人名・敬称（〇〇さん／ちゃん／くん）・`@メンション`・「Firstname Lastname」・肩書（大統領・アイドル等）を含むコメントは無条件で除外。誤検知は許容。ブロックされたコメントに画面は反応しない（煽らない）
2. **キャラは自分のものだけ**。参照画像・説明文に他人のキャラ・既存 IP・実在人物の顔を使わないでください。これは炎上リスクをあなたからプロジェクトに移さないための線引きです
3. **性的・暴力的表現**は同梱の NG リスト（`data/ng-words.txt`）とモデル側セーフティの二重
4. **配信者が主導**。ON/OFF・世界観・レート・承認は配信者が決める。視聴者が画面を勝手に汚せない
5. **AI 使用の明示**は既定 ON

## Metrics (JSONL)

`data/logs/session-<timestamp>.jsonl` に全イベントを追記します。主なもの：

| ev | fields |
|---|---|
| `comment_received` / `comment_filtered` | `reason`（`ng_word` `real_person` `rate_limit` `user_cooldown` `queue_full` `budget_exhausted` …） |
| `comment_selected` | `job` `text` |
| `gen_start` / `gen_done` / `gen_failed` | `backend` `genMs` `sinceReceivedMs` `costUsd` `spentUsd` `expandedPrompt` |
| `play_start` / `play_end` | `sinceReceivedMs`（**コメント受信→再生開始のレイテンシ**） |
| `youtube_poll` | `items` `pollingIntervalMillis` `estUnits` |
| `budget_exhausted` | `spentUsd` `budgetUsd` |

```bash
# コメント受信→再生開始の中央値（ms）
grep '"ev":"play_start"' data/logs/session-*.jsonl | jq -s 'map(.sinceReceivedMs) | sort | .[length/2|floor]'
```

## Architecture

```
src/
  chat/       ChatAdapter: youtube.ts (API key polling), manual.ts (HTTP injection)
  filter/     ngfilter.ts (blocklist + real-person heuristics), selector.ts (prefix / rate / cooldown)
  prompt/     builder.ts  (world + character + comment + audio)
  backend/    GenerateBackend: fal.ts (queue REST), local.ts (ComfyUI), mock.ts
  queue/      pipeline.ts (state machine: pending_approval → queued → generating → ready → playing → done)
  metrics/    logger.ts   (JSONL)
  server/     http.ts     (config UI, overlay, /api, WebSocket)
public/       overlay.html (OBS browser source), config.html
```

ドメイン非依存の配管です。「入力アダプタ → フィルタ → プロンプト合成 → 生成バックエンド → オーバーレイ」の各層はインターフェースで切ってあるので、Twitch 対応はアダプタ1ファイル、別モデル対応はバックエンド1ファイルで足ります。

## Development

```bash
npm run dev         # tsx watch
npm test            # filter / selector / prompt unit tests
npm run typecheck
```

## License

MIT
