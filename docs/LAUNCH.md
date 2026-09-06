# Launch kit

What to post, where, in which order. Everything below is written to be pasted; edit the numbers to the latest measurements before posting.

## Before the first post

- [x] Private repo pushed (`purankuton2001/castconjure`), history slimmed to ~25 MB, Discussions enabled
- [ ] Make it public: `gh repo edit purankuton2001/castconjure --visibility public --accept-visibility-change-consequences`
- [ ] **Right after going public** — Settings → General → **Social preview**: upload `docs/social-preview.png` (1280×640). The field only exists on public repos, and there is no API for it.
- [ ] **Right after going public** — Settings → Security → enable **Private vulnerability reporting** (CONTRIBUTING and SECURITY.md point people there)
- [ ] Topics: `ai-vtuber` `vtuber` `virtual-idol` `text-to-video` `minimax` `h3` `fal` `obs` `youtube-live` `livestream` `kpop` `anime` `generative-video` `typescript` `open-source`
- [ ] Discussions: create the Q&A + Show and tell categories, pin a "Post your persona (your own OC only)" thread
- [ ] Description: *Your own virtual idol, generated — not lip-synced. Chat makes her dance, eat, talk and change scenes, live. OSS, BYOK.*
- [ ] `docs/app-demo.mp4` uploaded to YouTube (unlisted is fine) for the posts that need a video link
- [ ] One demo stream recorded with a real chat (not the test panel) — the strongest asset; post the clip, not the GIF, wherever video is allowed
- [ ] Rotate the fal / Gemini keys you used while testing

## Order

1. **X (English)**, video attached, morning US time — quote-tweet it in Japanese and Korean the same day
2. **Show HN** the next morning (US), link to the repo, first comment = the honest technical breakdown
3. **Reddit**: r/VirtualYoutubers (show the persona), r/StableDiffusion (show the pipeline), r/kpophelp or r/kpopthoughts only if the tone fits — read the rules first
4. **fal / MiniMax**: DM or reply on their launch posts with the latency numbers and the recording; ask if they want a case study
5. **Discord**: fal's server (#showcase), AI VTuber / VTuber-dev servers

## X — English (main)

> I open-sourced a way to make your own AI VTuber that is *generated*, not lip-synced.
>
> Chat says "dance!!" → she notices in 0.2 s → 6 s later she's dancing, in her own voice, in the commenter's language.
>
> No 3D, no rigging. Face gacha → 3 references → voice → live in 10 min. Your own OC only.
>
> MiniMax H3 Max Turbo via fal, ~$0.25 per reaction. MIT, bring your own key.
>
> [video] github.com/purankuton2001/castconjure

Thread (replies):
1. How it stays consistent without reference audio: fixed seed + the same descriptions + starting every clip from a frame of her idle loop.
2. Why there's no dead time: 6 pre-generated "noticed your comment" clips play instantly while the reaction generates.
3. Latency breakdown (measured): reply ~1.3 s (Gemini) · fal queue + generation 2.5–4 s · download and cache ~1.5 s · playback handoff → 4–8 s comment to screen, ~6 s typical.
4. Safety: faces are generated in-app only; real idols / existing characters / "look like X" are blocked in chat and in prompts.
5. "Why not fal's continuous H3 Max Director?" — we ran it for 2 min from her idle frame: same face and voice, but a 120 s session cap, 3–19 s prompt-to-screen and fake chat UI drifting in by 90 s. Numbers + recording in the repo (`npm run probe:director`).
6. What's next: demo streams on YouTube, Twitch adapter, gift → directing rights.

## X — 日本語（引用）

> 口パクじゃなく「映像そのものを生成する」AI VTuber を OSS にしました。
> チャットで「踊って」→ 0.2 秒で気づいて → 6 秒後に本人の声で踊る。3D もリギングも不要、顔ガチャから 10 分。使えるのは自分の OC だけ。
> MiniMax H3 Max Turbo（fal）、反応 1 本 約 $0.25、MIT・BYOK。

## X — 한국어（인용）

> 립싱크가 아니라 "영상 자체를 생성하는" AI 버추얼 아이돌을 오픈소스로 공개했습니다.
> 채팅에 "춤춰줘" → 0.2초 만에 알아채고 → 6초 뒤 자기 목소리로 춤춥니다. 3D도 리깅도 없이 얼굴 가챠부터 10분. 나만의 OC만 사용 가능.
> MiniMax H3 Max Turbo (fal), 반응 1개 약 $0.25, MIT · BYOK.

## Show HN

Title (≤ 80 chars):

> Show HN: Castconjure – an AI VTuber that generates video instead of lip-sync

Body:

> castconjure turns a generated character into a live streamer. There is no rigged model: each reaction to a chat comment is a freshly generated 5-second clip (MiniMax H3 Max Turbo on fal) with her own voice, starting from a frame of her idle loop so the cut is seamless.
>
> The interesting bits:
> - Consistency without reference audio: a fixed per-persona seed plus identical appearance/voice descriptions keeps face and voice stable across clips.
> - Perceived latency: six pre-generated "noticed your comment" clips play 0.2 s after a comment while the real reaction generates (6–8 s measured). The reply subtitle only appears with the clip, so nothing is spoiled.
> - Safety as a design constraint: faces are generated in-app (no upload), and a blocklist + heuristics drop real idols, existing characters and "make her look like X" in chat, replies and prompts.
> - Everything is a BYOK interface: fal / local ComfyUI backends, YouTube Live via API key (no OAuth), Gemini / Claude / OpenAI for replies.
>
> ~$0.25 per reaction at 480p. MIT. Recording of the real app, from `npm start` to the third reaction, is in the repo.
>
> I'd love feedback on the consistency approach and on what a Twitch adapter should look like.

## Reddit — r/VirtualYoutubers

Title: *I made an open-source AI VTuber that generates every reaction as video (not lip-sync) — she notices your comment in 0.2 s and acts it out 6 s later*

Body: 3 sentences + the clip + "your own OC only, here's why" + repo link. Answer questions about cost honestly ($0.25 per reaction; idle loop is pre-generated).

## Reddit — r/StableDiffusion

Title: *Pipeline: chat → LLM reply + action → MiniMax H3 Max Turbo i2v from an idle frame → OBS, with fixed-seed consistency and a numerical A/V sync check (open source)*

Body: the architecture block from the README, the latency table, the seed trick, link.

## fal / MiniMax outreach (DM or reply)

> Built an open-source live persona pipeline on H3 Max Turbo (i2v from an idle frame, fixed seed, ~4 s generation). Measured queue vs generation, sync vs queue endpoints, r2v vs i2v — all in the README. Happy to write it up as a case study or share the JSONL logs if useful. [repo] [recording]

## Metrics to update before posting

- comment → screen: read the last `record:app` output (`reaction on screen after …`)
- cost per reaction: `data/logs/session-*.jsonl` → `gen_done.costUsd`
- stars / forks: the badge updates itself
