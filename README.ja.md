<p align="center">
  <a href="README.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
</p>

<h1 align="center">castconjure</h1>

<p align="center"><b>自分だけのバーチャルアイドルを、生成する。口パクじゃなく。</b></p>
<p align="center">
  顔を 1 回生成すれば、ライブ配信のコメントで推しが踊る・食べる・喋る・場所を変える。<br>
  コメントの約 6 秒後に、ファンの言語で。
</p>

<p align="center">
  <img src="docs/hero.gif" alt="視聴者が dance!! と打つと 0.2 秒で気づき、7 秒後に本人の声で踊る" width="720">
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-7c5cff"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-3ecf8e">
  <img alt="model" src="https://img.shields.io/badge/video-MiniMax%20H3%20Max%20Turbo%20via%20fal-1f2230">
  <img alt="chat" src="https://img.shields.io/badge/chat-YouTube%20Live-ff0000">
  <img alt="latency" src="https://img.shields.io/badge/%E3%82%B3%E3%83%A1%E3%83%B3%E3%83%88%E2%86%92%E7%94%BB%E9%9D%A2-%E7%B4%846%E7%A7%92-f5a623">
</p>

---

**castconjure** は、生成したキャラクターをそのまま配信者にする OSS（MIT・BYOK）です。3D モデルもリギングもモーションキャプチャも口パクもありません。反応はすべて、その場で生成される 5 秒の映像で、声も本人のもの。口パクアバターは口が動くだけ。castconjure は動作・衣装・カメラ・場所ごと生成します。

K-pop／アニメのファンダム向けに作っています。推しは 1 体、チャットは世界中、使えるのは自分のオリジナルキャラだけ。

## 体験

```
 0.0 秒   taro_k:  dance!!                                   （YouTube Live のチャット）
 0.2 秒   チャットを覗いて「え、なになに？ ちょっと待ってね」   ← 事前生成の「気づき」クリップ、即時
 6〜8 秒  立ち上がって踊る。字幕「taro_kさん！danceだね、やってみよ！」  ← いま生成、本人の声
 12 秒    待機ループに戻る
```

待ち時間の空白もネタバレもありません。返事は、それを演じる映像より先には出ません。`npm start` から 3 回目の反応までの実機録画：[docs/app-demo.mp4](docs/app-demo.mp4)

<p align="center"><img src="docs/app.gif" alt="実際のアプリ：ターミナル・設定パネル・OBS オーバーレイ" width="800"></p>

## 10 分で動かす

```bash
git clone https://github.com/purankuton2001/castconjure && cd castconjure
npm install && cp .env.example .env
npm start
```

**http://127.0.0.1:8787/** を開く。同梱の推し「白詰ゆい」が選ばれていて、最初は無料の mock で一周できます。

1. **Persona → 顔ガチャ**：4 枚引いて 1 枚クリック、派生した参照（顔・全身・部屋）を確認して保存
2. **声ガチャ**：`npm run voice:gacha -- --n 2` → 気に入った番号を `npm run voice:gacha -- --adopt 1`
3. **待機プール**と**気づきクリップ**：`npm run idle -- --n 12`、`npm run ack -- --n 6`
4. OBS に **ブラウザソース**：`http://127.0.0.1:8787/overlay`、1920 × 1080
5. **▶ Start** → Test comment に「dance!!」。気づいて、踊る

本番はキーを `.env` に入れるだけ（外には出ません）：

```bash
BACKEND=fal            FAL_KEY=…              # fal.ai に直接課金、反応 1 本 約 $0.25
PLATFORM=youtube       YOUTUBE_API_KEY=…      # 自分の Google Cloud プロジェクト、OAuth 不要
REPLY_PROVIDER=gemini  GEMINI_API_KEY=…       # anthropic / openai も可。コメントの言語で返す
```

配信を始めて、動画 ID をパネルに貼って Start。

## 口パクアバターと何が違うか

| | Live2D／口パク | スタジオ製バーチャルアイドル | fal.live 型の無限配信 | **castconjure** |
|---|---|---|---|---|
| 動くもの | 口と首 | 全部（スタジオ込み） | 全部（固定の人格なし） | **全部。固定の推しがチャットで動く** |
| 作るには | 絵とリギングで数週間 | 数か月とチーム | — | **顔ガチャ→参照 3 枚→声→人格、約 10 分** |
| 一貫性 | モデルデータ | モデルデータ | なし | **固定 seed＋同じ説明文＋待機フレーム起点** |
| 声 | 別の TTS | 演者 | なし | **映像と一緒に生成。同じ seed で同じ声** |
| 費用 | GPU／サブスク | 予算 | 24 時間生成 | **待機は事前生成、反応 1 本 約 $0.25** |
| キーとデータ | 相手側 | 相手側 | 相手側 | **自分** |

## 入っているもの

- **二層オーバーレイ**：待機ループの上に反応クリップをクロスフェード。OBS ブラウザソース 1 枚
- **気づきクリップ**：コメント 0.2 秒後に「気づいて一言」の事前生成クリップ 6 本からランダム再生
- **返事モード**：LLM（Gemini／Claude／OpenAI、自分のキー）がコメントの言語で一言。台詞と字幕になる
- **動作ディレクター**：「dance!!」を「立ち上がって全身で踊り、1 回転」に変換して映像に出す
- **推しはフォルダ**：`data/personas/<id>/` に参照・声・seed・待機・気づき。コピーして共有できる
- **自分の OC だけ**：実在アイドル・グループ・アニメ／ゲームのキャラ・「〇〇に似せて」「振付」は黙って除外（英・韓・日）
- 承認モード、レート制限、視聴者ごとの冷却、セッション予算、コメント→クリップの JSONL ログ
- **バックエンド**：fal（既定は H3 Max Turbo の image-to-video、厳密モードは reference-to-video）、ローカル ComfyUI、mock
- **ツール**：`record:live`／`record:app`（headless の実機録画、レイテンシ計測、音声同期の数値検査）、`probe`、`probe:voice`

## 費用

fal で 2026 年 9 月に実測：

| 経路 | 反応 1 本（5 秒・480p） | コメント → 画面 |
|---|---|---|
| H3 Max Turbo image-to-video（既定） | **$0.25** | **4〜8 秒** |
| H3 Max reference-to-video（参照 3 枚＋参照音声） | $0.46 | 10〜13 秒 |

推しごとに 1 回：待機 12 本 ≈ $3、気づき 6 本 ≈ $1.5、参照 ≈ $0.15。30 秒に 1 回の反応で 60 分 ≈ $30。セッション上限は既定 $20。fal 側の月次上限も設定を。

## 安全設計

1. **自分のオリジナルキャラだけ**。顔はアプリ内生成のみでアップロードはない。全プロンプトに「架空の成人、実在アイドル・既存キャラに似せない」が付く
2. **実在アイドル・既存 IP はどこでも除外**：コメント、返事、人格欄、顔ガチャ。「〇〇に似せて」「振付」も
3. **成人のみ。声は生成で、実在人物からの複製はしない。実在楽曲・振付は使わない**
4. **持ち主が主導**：ON/OFF・世界観・レート・承認・予算
5. **AI 明示**：表記は既定 ON。配信側でも合成コンテンツの開示を

castconjure は実在のアイドルを踊らせる道具でも、その代替でもありません。あなたの OC です。

## 貢献

Issue と PR を歓迎します。[CONTRIBUTING.md](CONTRIBUTING.md) を参照。最初の一歩に向くもの：Twitch アダプタ、新しい推しテンプレート、README の翻訳、あなたの言語の気づき台詞。

詳しい使い方（日本語）：[docs/GUIDE.md](docs/GUIDE.md)

## ライセンス

MIT。生成費用は利用者自身の fal アカウントに直接課金され、本プロジェクトは仲介しません。モデルは MiniMax H3（[fal](https://fal.ai) 経由）。
