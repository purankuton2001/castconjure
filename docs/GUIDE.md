# castconjure 使い方ガイド

起動・OBS 設定・fal / YouTube 接続・配信中の運用・ログの読み方。英語の概要は [README](../README.md)。

## 1. これは何か

ローカルで動く小さなサーバー。起動すると 2 つの画面を配ります。

| URL | 役割 |
|---|---|
| `http://127.0.0.1:8787/` | **設定 UI**。Start／Stop、世界観、レート、承認、予算、テストコメント |
| `http://127.0.0.1:8787/overlay` | **オーバーレイ**。OBS のブラウザソースに貼る透過画面。クリップ・投稿者名・「AI生成」表記だけが出る |

生成の裏側は `mock`（$0・テキストカード）/ `fal`（H3 Max・リアルタイム）/ `local`（ComfyUI・事前生成）。

## 2. まず動かす（mock・費用ゼロ）

```bash
cd castconjure
npm install && cp .env.example .env   # 初回のみ。既定は BACKEND=mock, PLATFORM=manual
npm start
```

1. `http://127.0.0.1:8787/` を開く
2. **▶ Start**。ヘッダーが running、チャット欄が「manual: inject comments…」になる
3. Test comment に `猫がサーフィンしてる` と入れて Send。Log に `selected → generated in 2.5s ($0.000)` と流れ、Queue が playing になれば一周

オーバーレイを別タブで開いておくと「生成中…」→ 5 秒のカード → 消える、を目で追えます。位置確認は `/overlay?pos=c&w=800` が見やすい。

## 3. OBS に載せる

1. ソース追加 → **ブラウザ**
2. URL `http://127.0.0.1:8787/overlay`、幅 **1920**、高さ **1080**
3. 「ソースが表示されていないときにシャットダウン」は **OFF**
4. 音声ありなら URL に `?audio=1`、OBS 側で「音声をコントロール」を ON

| param | 値 | 意味 |
|---|---|---|
| `pos` | `full` `br` `bl` `tr` `tl` `c` | 全画面（既定、推しが主役）か枠付き |
| `w` | px | 枠付きのときの幅（既定 960） |
| `idle` | `0` | 待機層を切る（反応クリップだけ） |
| `pad` | px | 画面端からの余白（既定 32） |
| `audio` | `1` | 音声ありで再生 |
| `wait` | `0` | 生成中プレースホルダを出さない |
| `accent` | `%237c5cff` | 投稿者名の帯の色 |

オーバーレイは自動再接続するので、サーバーを再起動しても OBS 側は触らなくて済みます。

## 4. 設定 UI の項目

右カラムで編集して **Save settings**。`data/settings.json` に保存され、再起動しても残ります。`.env` は初期値。

| 項目 | 内容 |
|---|---|
| World prompt | 配信ごとに変える世界観。全プロンプトの先頭に入る |
| Character | 固定のキャラ。名前・説明・禁止事項・参照画像（`data/characters/` のファイル名か URL、最大 3 枚）。参照画像があると reference-to-video 経路 |
| Min interval / User cooldown | 全体で何秒に 1 件拾うか／同じ人の連投を何秒抑えるか。既定 30 / 120 |
| Command prefix | `!gen` を入れると、そう始まるコメントだけ拾う。空なら全コメント |
| Approval mode | ON で、配信者かモデレーターが通したものだけ生成 |
| Budget per session | Start 時に $0 に戻り、到達で生成停止。Reset budget で解除 |
| Resolution / Duration | 480p / 768p、5〜10 秒。既定は最安の 480p・5 秒 |
| Extra NG words | あなたの名前、チャンネル名、触れてほしくない話題 |

コントロールバー：**▶ Start**（取得開始、予算・統計リセット）／**■ Stop**／**⏸ Pause generation**（受付は続け生成だけ止める）／**Reset budget**。

## 4b. 推しを作る（v0.7）

右カラムの **推し（persona）** セクション。同梱の白詰ゆいがあるので、まずはこれで通す。

1. **顔ガチャ**：「4 枚引く」→ 気に入った顔をクリック → 全身と世界観の参照画像を派生生成 → 3 枚を見て「確認して保存」。顔はここで生成したものしか使えない（写真アップロードはない）。FAL_KEY がなければプレースホルダ画像
2. **声**：サンプル台詞で TTS 生成。実在人物の声は使わない
3. **人格**：名前・ファンの呼び方・見た目（英語）・シグネチャ・既定の世界観・話し方・口癖・禁止事項・返事のシステムプロンプト。「人格を保存」
4. **待機映像プール**：本数を決めて「生成する」。推定費用が出る（fal で 12 本 ≈ $5.5、mock/local は $0）。できた分から overlay の待機層で自動ループ

推しはフォルダ `data/personas/<id>/` に入る。コピーすれば別マシンで同じ推し。

**返事モード**（Generation セクションのチェック）：コメントごとに LLM が推しの一言（30 字以内）を返し、台詞としてプロンプトと字幕に使う。`.env` の `REPLY_PROVIDER`（mock / anthropic / gemini / openai）とキーが必要。返事も NG フィルタを通り、ブロックされたら口癖に置き換わる。

## 5. fal で本物の映像に

1. [fal.ai](https://fal.ai/dashboard/keys) でキーを発行し `.env` に `FAL_KEY=...`
2. `BACKEND=fal`（または設定 UI の Backend を fal にして Save）
3. fal ダッシュボードで **月次支出上限** も設定（セッション上限と二重に）

配信前に 1 本だけ試す（サインイン済みなら 1 日 5 回の無料枠）：

```bash
npm run gen:once -- "小さなドラゴンがくしゃみして誕生日のろうそくに火をつける"
```

| 経路 | 単価 | 5 秒 | 30 秒間隔で 60 分 |
|---|---|---|---|
| text-to-video 480p | $0.05/秒 | $0.25 | 約 $30 |
| text-to-video 768p | $0.08/秒 | $0.40 | 約 $48 |
| reference-to-video | $0.08/秒 + $0.02/枚 | $0.42〜0.46 | 約 $50〜55 |

H3 Max 自体に音声パラメータはなく、「Generate with audio」はプロンプト文言にだけ効きます。クリップは `data/clips/` に保存してから再生するので、fal 側 URL が失効しても配信は止まりません。

## 6. YouTube Live につなぐ

OAuth なし。公開配信のライブチャットは API キーだけで読めます。

1. Google Cloud でプロジェクトを作り **YouTube Data API v3** を有効化 → 認証情報 → API キー
2. `.env` に `YOUTUBE_API_KEY=...`、`PLATFORM=youtube`
3. 配信を **開始してから**、設定 UI の YouTube video ID に URL の `v=` を入れて Save → ▶ Start

Log に `baseline N historical messages skipped` と出れば接続済み。Start 以前のコメントは拾いません。

クォータは 1 プロジェクト 1 日 10,000 unit（太平洋時間 0 時リセット）。API が返す `pollingIntervalMillis` より速くはポーリングしません。統計の「yt polls N (~M units)」を Google Cloud コンソールの実測と突き合わせてください（1 回あたりの unit は `YOUTUBE_UNITS_PER_POLL`、既定 5 で推定）。クォータ超過・配信終了時はポーリングを止め、配信自体は止めません。

## 7. 配信中の運用

**承認モード**：フィルタを通ったコメントは Pending に並ぶ。設定 UI の ✓／✕、またはチャットで配信者・モデレーターが `!ok`（最新を承認）か `!ok @名前`。視聴者の `!ok` は黙って捨てる。

**拾われないコメント**：画面は反応しない（煽らない）。理由はログにだけ残る。

| reason | 意味 |
|---|---|
| `real_person` | 〇〇さん／ちゃん／くん、@メンション、Firstname Lastname。誤検知は許容 |
| `ng_word` | 同梱リスト（`data/ng-words.txt`）か Extra NG words |
| `url` | URL を含む |
| `rate_limit` / `user_cooldown` | 間隔が足りない |
| `no_command_prefix` | Command prefix 指定時に付いていない |
| `queue_full` | Max queue 超過 |
| `budget_exhausted` | セッション予算到達 |

**初回デモのおすすめ**：480p・5 秒・30 秒間隔・予算 $20、prefix 空、承認 OFF。荒れたら承認モードか `!gen` 縛りに。配信中に Save 一発で変えられます。

## 8. ローカル（ComfyUI）

RTX 4090 で 5 秒に約 50 秒。「事前生成モード」なので Min interval は 90 秒以上に。

1. ComfyUI で H3 ワークフローを組み **Save (API Format)**
2. `local/workflow.example.json` を参考に、値を `{{PROMPT}}` `{{FRAMES}}` `{{RESOLUTION}}` `{{SEED}}` `{{REFERENCE_IMAGE}}` に置き換えて `local/workflow.json` に保存
3. `.env` に `BACKEND=local`、`COMFY_URL=http://127.0.0.1:8188`

出力ノードは mp4/webm を吐くもの（VHS_VideoCombine など）。

## 9. 安全ルール（既定のまま使う）

- **実在人物は生成しない**：人名・敬称・@メンション・肩書を含むコメントは無条件除外
- **キャラは自分のものだけ**：他人のキャラ・既存 IP・実在人物の顔を参照画像や説明文に使わない
- **性的・暴力的表現**は NG リストとモデル側セーフティの二重
- **配信者が主導**：ON/OFF・世界観・レート・承認は配信者が決める
- **「AI生成」表記**は既定 ON

## 10. 実測ログ

`data/logs/session-<時刻>.jsonl` に全イベントを追記。デモ配信後に公開する「実測」はこれ。

| ev | 主なフィールド |
|---|---|
| `comment_received` / `comment_filtered` | `author`, `reason` |
| `comment_selected` | `job`, `text`, `approval` |
| `gen_start` / `gen_done` / `gen_failed` | `backend`, `genMs`, `sinceReceivedMs`, `costUsd`, `spentUsd`, `expandedPrompt` |
| `play_start` / `play_end` | `sinceReceivedMs`（コメント受信→再生開始）, `playMs` |
| `youtube_poll` | `items`, `pollingIntervalMillis`, `estUnits` |

```bash
grep '"ev":"play_start"' data/logs/session-*.jsonl | jq -s 'map(.sinceReceivedMs) | sort | .[length/2|floor]'
```

目標は fal 経路で 15 秒以内。mock の実測は約 2.5 秒。

## 11. 困ったとき

| 症状 | 対処 |
|---|---|
| `chat adapter failed` | 動画 ID が違うか、まだ配信が始まっていない。配信開始後に Start し直す |
| `backend "fal" unavailable` | `FAL_KEY` が空。mock に落ちるので、キーを入れて再起動 |
| OBS に何も出ない | Queue に playing があるなら、ブラウザソースを右クリック → 更新。URL の `127.0.0.1:8787` を確認 |
| コメントが拾われない | JSONL の `comment_filtered` の reason を見る。たいてい `rate_limit` か `real_person` |
| 生成が止まった | 予算表示に exhausted → Reset budget。Pause 中なら Resume |
| 費用が読めない | `costUsd` は推定。fal ダッシュボードの請求が正 |

## 12. 早見表

```
npm start                 本番起動
npm run dev               自動再起動
npm test                  テスト
npm run gen:once -- "…"   1 本だけ生成
npm run probe -- --n 20   顔一貫性の実測（N 本 + 評価用 HTML）

http://127.0.0.1:8787/            設定 UI
http://127.0.0.1:8787/overlay     OBS ブラウザソース

!gen …      Command prefix 設定時のみ
!ok         モデレーター／配信者：最新の保留を承認
!ok @名前   その人の保留を承認
```
