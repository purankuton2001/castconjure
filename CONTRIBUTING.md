# Contributing to castconjure

Thanks for looking. castconjure is small on purpose: a pipeline of interfaces (chat adapter → filters → reply → prompt → backend → overlay) with a persona folder in the middle. Most contributions are one file.

## Good first contributions

- **A chat adapter** (Twitch, Kick, TikTok LIVE): implement `ChatAdapter` in `src/chat/`, wire it in `pipeline.ts`.
- **A persona template** in `personas/<id>/persona.json` — your own original character only (see Safety in the README).
- **Ack lines / reply prompts in your language** in `src/prompt/builder.ts` (`ACK_LINES`) and `src/reply/llm.ts`.
- **A README translation** (`README.<lang>.md`, add it to the language line at the top of every README).
- **Names for the own-OC-only guard** in `data/ip-names.txt` (real idols, groups, characters, titles in your language).

## Development

```bash
npm install
cp .env.example .env     # mock backend, no keys needed for the loop
npm run dev              # tsx watch
npm test                 # unit tests (filters, selector, prompts, reply parsing)
npm run typecheck
```

Recording and measuring (needs fal keys and Google Chrome):

```bash
node scripts/record-app.mjs --comments "dance!!|what's your favorite food?"   # end-to-end demo with A/V sync check
python3 scripts/check-sync.py --rec <recording.webm> --events <events.json>    # verify audio/video alignment
```

## Pull requests

- One change per PR; keep the interfaces (`ChatAdapter`, `GenerateBackend`, `Persona`) stable or explain why.
- Add or update a test in `test/` when you touch filters, prompts or reply parsing.
- Don't add anything that lets a real person's face or voice into the pipeline. That rule is what keeps this project shippable.
- English in code and docs; Japanese and Korean are welcome in persona content and translations.

## Reviewing

Reviews are how this project scales, and anyone can do one — you do not need write access. A review is worth as much as a PR.

How to review:

1. Check out the branch and run `npm test` and `npm run typecheck` (mock backend, no keys needed).
2. Read the diff against the rules under **Pull requests** above: one change, stable interfaces, a test when filters or prompts change, nothing that lets a real person or an existing character in.
3. Post your findings as a GitHub review on the PR (approve / request changes / comment), in your own words.

Using an AI coding tool to review is welcome — run it on your own machine, on your own account or subscription, and post the result under your own name. You are responsible for what you post, so cut anything you did not check. Never share API keys or subscription tokens with other contributors or put them in the repo.

Merging:

- Every PR needs one approving review before it is merged. Reviews from contributors without write access are read the same way; a maintainer adds the formal approval.
- Changes to the safety guards (`src/filter/`, `data/ip-names.txt`, `src/persona/facegen.ts`, `src/persona/voice.ts`) also need a maintainer's approval — see `.github/CODEOWNERS`.
- Contributors who review well and often are offered write access so their approvals count on their own. Write access is for reviewing; merging stays with maintainers by convention.

## Reporting a safety issue

If you find a way to bypass the real-person / existing-IP guards, open an issue titled `safety:` — or, if you prefer, a private report via GitHub's "Report a vulnerability" (see [SECURITY.md](SECURITY.md)).
