<p align="center">
  <a href="README.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a>
</p>

<h1 align="center">castconjure</h1>

<p align="center"><b>Your own virtual idol, generated — not lip-synced.</b></p>
<p align="center">
  Conjure a face once. Your live chat makes her dance, eat, talk and change scenes —<br>
  on your stream, ~6 seconds after the comment, in whatever language your fans speak.
</p>

<p align="center">
  <img src="docs/hero.gif" alt="A viewer types dance!! — she notices the comment within 0.2 s, then dances about 6 s later, with her own voice" width="720">
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-7c5cff"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-3ecf8e">
  <img alt="model" src="https://img.shields.io/badge/video-MiniMax%20H3%20Max%20Turbo%20via%20fal-1f2230">
  <img alt="chat" src="https://img.shields.io/badge/chat-YouTube%20Live-ff0000">
  <img alt="latency" src="https://img.shields.io/badge/comment%20%E2%86%92%20screen-4%E2%80%938%20s-f5a623">
  <a href="https://github.com/purankuton2001/castconjure/stargazers"><img alt="stars" src="https://img.shields.io/github/stars/purankuton2001/castconjure?style=flat&color=e8e9ee"></a>
</p>

<p align="center">
  <a href="#quick-start-10-minutes">Quick start</a> ·
  <a href="#how-it-feels">How it feels</a> ·
  <a href="#why-not-a-lip-sync-avatar">Why</a> ·
  <a href="#cost">Cost</a> ·
  <a href="#safety-by-design">Safety</a> ·
  <a href="docs/GUIDE.md">Guide (JA)</a> ·
  <a href="docs/REQUIREMENTS.md">Requirements (JA)</a> ·
  <a href="https://github.com/purankuton2001/castconjure/discussions">Discussions</a>
</p>

---

**castconjure** is an open-source, bring-your-own-key tool that turns a generated character into a live streamer. There is no 3D model, no rigging, no motion capture and no lip-sync puppet: every reaction is a freshly generated 5-second video with her own voice. Lip-sync avatars move a mouth. castconjure generates the whole shot — action, outfit, camera, scene.

Built for the K-pop / anime fandom era: one idol, a global chat, your own original character only.

## How it feels

```
 0.0 s   taro_k:  dance!!                                (YouTube Live chat)
 0.2 s   she glances at the chat: "Oh! A new comment. Let me see…"   ← pre-generated ack clip, instant
 4–8 s   she springs up and dances — subtitle: "taro_kさん！danceだね、やってみよ！"   ← generated now, her voice
12 s     back to her idle loop, waiting for the next one
```

No dead time and no spoiler: the reply is never shown before the clip that acts it out. She answers in the commenter's language; the recordings on this page were made with Japanese replies. Watch the full recording of the real app, from `npm start` to the third reaction: [docs/app-demo.mp4](docs/app-demo.mp4).

<p align="center"><img src="docs/app.gif" alt="The real app: terminal, control panel and OBS overlay" width="800"></p>

## Quick start (10 minutes)

```bash
git clone https://github.com/purankuton2001/castconjure && cd castconjure
npm install && cp .env.example .env
npm start
```

Needs Node ≥ 20 and **ffmpeg** on your PATH (`brew install ffmpeg` / `apt install ffmpeg`). The recording and probe scripts under `scripts/` also need Python 3 with Pillow and Google Chrome.

Open **http://127.0.0.1:8787/**. The bundled persona (白詰ゆい / Yui) is selected and everything runs on a free mock backend first, so the loop works before you spend anything (on mock she shows a text card instead of a clip).

1. **Persona → Face gacha** — draw 4 faces, click one, confirm the derived references (face / full body / in scene).
2. **Voice gacha** (needs `FAL_KEY`; H3 generates the candidate voices) — `npm run voice:gacha -- --n 2`, pick the one you like: `npm run voice:gacha -- --adopt 1`.
3. **Idle pool** and **ack clips** — `npm run idle -- --n 12` and `npm run ack -- --n 6`.
4. OBS → add a **Browser** source: `http://127.0.0.1:8787/overlay?audio=1`, 1920 × 1080 (drop `?audio=1` if you route her voice through OBS yourself).
5. Press **▶ Start**. Type *dance!!* in *Test comment*. She notices, then dances.

To go live, put your keys in `.env` — they never leave your machine:

```bash
BACKEND=fal            FAL_KEY=…              # fal.ai — you pay fal directly, ~$0.25 per reaction
PLATFORM=youtube       YOUTUBE_API_KEY=…      # your own Google Cloud project, no OAuth needed
REPLY_PROVIDER=gemini  GEMINI_API_KEY=…       # or anthropic / openai — she answers in the commenter's language
```

Start your stream, paste the video ID into the panel, press Start.

## Why not a lip-sync avatar

| | Live2D / lip-sync avatars | Studio virtual idols (3D + mocap) | fal.live / infinite streams | **castconjure** |
|---|---|---|---|---|
| What moves | mouth and head | everything, with a studio | everything, no fixed persona | **everything — a fixed persona, driven by chat** |
| To create one | weeks of art + rigging | months + a team | — | **face gacha → 3 references → voice → personality, ~10 min** |
| Consistency | rigged model | rigged model | none | **fixed seed + the same descriptions + her idle frame as the first frame** |
| Voice | separate TTS | actor | none | **generated with the video, same seed → same voice** |
| Cost | GPU / subscription | budget | 24/7 generation | **idle loop pre-generated; ~$0.25 per reaction** |
| Keys / data | theirs | theirs | theirs | **yours** |

Seed-based consistency applies to the fal backends; the local ComfyUI backend does not pass the seed yet. v0.1 generates a female persona only — other presets are on the roadmap.

### Why not a continuous stream (H3 Max Director)?

We measured it. `npm run probe:director` opens a real `minimax/h3-max/director` WebRTC session from her idle frame with her seed, changes the prompt at 30 / 60 / 90 s and records audio + video. Findings (September 2026, full numbers in [docs/DIRECTOR-PROBE.md](docs/DIRECTOR-PROBE.md)):

| | H3 Max Director (continuous) | castconjure (clips) |
|---|---|---|
| prompt change → visible | 3–19 s, depends on where in the 8.5 s chunk it lands | 4–8 s, ack clip at 0.2 s |
| session | capped at 120 s, then the stream ends | unlimited |
| consistency over 2 min | face and voice hold; earrings, hair and fake chat UI drift in | every clip starts from the same idle frame |
| cost | $1.2 / min promo ($4.8 / min list), 60 s minimum | ~$0.25 per reaction, idle is free |

Director is the same trick (Turbo image-to-video chained from the previous frames) done server-side. It becomes a "live mode" backend the day the session cap goes away; the probe script is the starting point.

## What's inside

- **Two-layer overlay** — a pre-generated idle loop underneath; reaction clips crossfade on top. One OBS browser source.
- **Ack clips** — six pre-generated "noticed your comment" clips play 0.2 s after a comment while the reaction generates.
- **Reply mode** — an LLM (Gemini / Claude / OpenAI, your key) answers each comment in the commenter's language; the line becomes her spoken words and the subtitle.
- **Action director** — "dance!!" becomes "she springs up and dances, spinning once, hair flying" so the clip actually shows it.
- **Persona folder** — `data/personas/<id>/`: references, voice, seed, idle and ack pools. Copy it, share it, version it.
- **Own-OC-only guard** — real idols, groups, anime/game characters, "look like X" and choreography requests are dropped silently. The denylist (`data/ip-names.txt`, EN / KO / JA + global pop) is a safety filter, not an endorsement or a target list; additions welcome.
- **Approval mode**, rate limits, per-viewer cooldown, session budget cap, JSONL metrics of every comment → clip.
- **Backends** — fal (H3 Max Turbo image-to-video by default, reference-to-video for max consistency), local ComfyUI, mock.
- **Tooling** — `record:live`, `record:app` (headless end-to-end recording with measured latency and a numerical A/V sync check), `probe`, `probe:voice`, `probe:director` (2-minute H3 Max Director session, recorded and measured).

## Architecture

```
create once   face gacha ─► references (face / full / scene) ─► voice gacha (H3) ─► personality + seed ─► idle pool + ack pool
live          chat ─► filters ─► reply (LLM) + action ─► prompt ─► H3 Max Turbo i2v from the idle frame ─► overlay
              └ ack clip plays at 0.2 s ────────────────────────────────────────── reaction crossfades in at ~6 s ┘
```

```
src/
  chat/       youtube.ts (API key only, honours pollingIntervalMillis) · manual.ts
  filter/     ngfilter.ts (NG words, real-person heuristics) · ipguard.ts (real idols / existing IP) · selector.ts
  reply/      llm.ts — reply + action director (mock | gemini | anthropic | openai)
  prompt/     builder.ts — world + persona + comment + reply + voice description; idle/ack prompts
  backend/    fal.ts (queue API, r2v / i2v / i2v-turbo, fixed seed) · local.ts (ComfyUI) · mock.ts
  persona/    store.ts · facegen.ts · voice.ts (voice gacha; clone is fed generated audio only)
  cli/        gen-once · probe · probe-voice · probe-latency · probe-turbo · idle-pool · ack-pool · voice-gacha · persona-import
  queue/      pipeline.ts — state machine, ack bridging, cache-first playback, budget, metrics
  server/     http.ts — panel, overlay, /api, /personas, WebSocket
public/       overlay.html (OBS) · config.html (panel, EN / ?lang=ja) · demo.html (recording layout)
scripts/      record-app.mjs · record-live.mjs · burn-captions.py · align-clip.py · check-sync.py · director-probe.mjs · variety.mjs
```

Every layer is an interface: Twitch is one adapter file plus a switch in `pipeline.ts`, another video model is one backend file, a persona is a folder.

## Cost

Measured on fal, September 2026:

| route | per reaction (5 s, 480p) | comment → screen |
|---|---|---|
| H3 Max Turbo image-to-video (default) | **$0.25** | **4–8 s** (generation 2.5–4 s + queue + cache) |
| H3 Max reference-to-video, 3 refs + reference voice | $0.46 | 10–13 s |

One-time per persona: idle pool 12 × $0.25 ≈ $3, ack pool 6 × $0.25 ≈ $1.5, references ≈ $0.15. A 60-minute stream at one reaction per 30 s ≈ $30. Session cap defaults to $20; set a monthly cap on the fal dashboard too. The Turbo per-second price is not listed on fal's page; the estimates assume it equals H3 Max (`PRICE_TURBO_480P` in `.env` overrides it once your invoice says otherwise).

## Safety by design

1. **Your own original character only.** Faces are generated in-app; the UI has no upload (`npm run persona:import` is a developer path for artwork you made yourself). Every face-generation prompt carries "fictional adult, not resembling any real idol or existing character".
2. **Real idols and existing IP are blocked everywhere** — comments, replies, persona text, gacha prompts. "Look like X", "cosplay as X", "do X's choreo" too.
3. **Adults only. Voice is generated, never cloned from a real person** — the clone step only accepts audio that `voice:gacha` itself generated. **No real music, no real choreography.**
4. **The owner is in charge** — on/off, world, rate, approval, budget. Viewers cannot paint on your screen without you.
5. **AI is disclosed** — the badge is on by default; label the stream as synthetic content.

castconjure is not a way to make a real idol dance for you, and not a replacement for one. It is *your* OC.

## Roadmap

- [x] YouTube Live, fal H3 Max / Turbo, local ComfyUI, mock · NG + IP guard · approval · budget · metrics
- [x] Persona: face gacha, voice gacha, seed, idle pool, ack clips, reply mode, two-layer overlay
- [x] Headless end-to-end recording with numerical A/V sync verification
- [ ] Demo streams #1–#3 (planned) with published latency / cost logs
- [ ] Male / non-binary persona presets (v0.1 hard-codes a female face and voice)
- [ ] Twitch adapter · gift → directing rights (outfit change, scene change, close-up)
- [ ] Anime style preset tuning · continuous "live mode" backend once fal Director drops its 120 s session cap (see `probe:director`)

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first contributions: a Twitch adapter, a new persona template, a translation of this README, more ack lines in your language.

## License

MIT. Generation costs are billed to *your* fal account; this project neither pays nor proxies. Model: MiniMax H3 via [fal](https://fal.ai); generated media is subject to fal's and MiniMax's terms.
