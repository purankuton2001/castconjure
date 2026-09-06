# H3 Max Director probe (fal realtime, WebRTC) — 2026-09-06

`npm run probe:director` opens one `minimax/h3-max/director` session from headless Chrome (`scripts/director-probe.mjs` + `scripts/director-page.mjs`), starts from the persona's idle frame with its fixed seed, updates the prompt at 30 / 60 / 90 s (idle → dance → wave + laugh → sip from a mug, lines in EN / JA / KO), records audio + video with `MediaRecorder`, and logs every server message. Output: `out/director/` (`session.webm`, `events.json`, screenshots, `contact-sheet.png`).

## What the session reported

| item | value |
|---|---|
| backend | `minimax-h3-turbo-balancer` (Director runs on H3 **Turbo**) |
| session cap | `max_session_seconds: 120`, `one_session_per_machine: true` → the stream stops after 2 min (`stream_exhausted / session_limit`) |
| chunking | 10 s requested, 8.5 s played, 39 context frames (1.5 s) re-used for continuation |
| generation per chunk | 1.8–3.1 s (avg 2.0 s), i.e. the same speed as our Turbo i2v clips |
| first video on screen | 9.2 s after opening the session (upload + negotiation + first chunk) |
| audio | 32 kHz, generated with the video, background music appears on its own |

## Prompt update → visible change

| update | `prompt_applied` after send | first chunk with new prompt | visible on screen (≈ + remaining playback of current chunk) |
|---|---|---|---|
| v2 dance @30 s | +9.3 s | +11.3 s | ~12–19 s |
| v3 wave @60 s | +5.1 s | +7.4 s | ~8–15 s |
| v4 mug @90 s | +0.8 s | +2.7 s | ~3–11 s |

The delay depends on where in the 8.5 s chunk cycle the update lands. Median is not better than the current pipeline (comment → screen 4–8 s with an instant ack clip at 0.2 s).

## Consistency over 2 minutes (see `out/director/contact-sheet.png`)

- Face, hair colour, cardigan, clover pin and room stayed recognisable for the whole session. Voice stayed the same throughout (Gemini transcription: same pitch and laugh pattern across EN / JA / KO, all four lines spoken).
- Drift: earrings appeared at ~25 s, hair became longer and wavier, and from ~85 s the model hallucinated a stream timer ("02:19") and fake chat bubbles on the frame. The "dance" became a sung segment with generated music.

## Cost

$0.02 / s promo (75 % off) → $1.2 / min, $72 / h; list $0.08 / s → $288 / h. 60 s minimum per session. Our current route: idle loop pre-generated, ~$0.25 per reaction (~$30 / h at one reaction per 30 s).

## Verdict

Not adopted as the default. The 120 s session cap alone rules out a continuous stream today; the update latency is not lower than the clip pipeline; drift accumulates within 2 minutes; and the cost is 2–10× higher. Director is what we already do (Turbo i2v chained from the previous frames), done server-side. Revisit as an optional "live mode" if fal lifts the session cap — the probe script is the starting point for that backend.
