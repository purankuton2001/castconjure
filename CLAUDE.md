# CLAUDE.md

Guidance for Claude Code (and any other AI coding tool) working in this repository. Humans: the same rules apply to you; see also [CONTRIBUTING.md](CONTRIBUTING.md).

## This repository is public. History is forever.

Everything committed here is visible to anyone, in the current tree **and in every past commit**. Removing something later means rewriting history and force-pushing, which invalidates every clone and PR in flight. We did that once before publishing; the rules below exist so it never has to happen again.

**Before every commit, read the staged diff (`git diff --cached`) and the commit message with that in mind.** If in doubt, leave it out and ask.

### Never commit

- **Secrets**: API keys (fal, YouTube, Gemini, Anthropic, OpenAI), tokens, cookies, signed URLs, `.env` files. `.env.example` holds empty placeholders only. If a key is ever committed, the fix is to rotate the key, not just to delete the file.
- **Personal or employment information**: the owner's or anyone's personal email, real name, address, employer, day job, side-business or non-compete considerations, business or exit plans, negotiations, income. Planning documents in `docs/` describe the product; they do not describe the author's life or work situation.
- **Private notes** of any kind: to-do lists for one person, draft messages to third parties, meeting notes, internal checklists. Put those in `local/notes/` (gitignored) or outside the repo.
- **Third-party private data**: chat logs, viewer names from a real stream, screenshots with other people's handles, anything under `data/` (already gitignored: `data/logs`, `data/clips`, `data/characters`, `data/personas`, `data/settings.json`).
- **Real people**: no photos, voices, names or likenesses of real people in personas, references, prompts, test fixtures or demo media. This is also the project's core safety rule.
- **Session or tool metadata**: no `Claude-Session:` trailers, session IDs, session URLs, local absolute paths (`/Users/...`, `/home/...`, `C:\...`), machine names or internal hostnames in commits, code or docs.

### Commit identity and messages

- Commit as `purankuton <purankuton2001@users.noreply.github.com>`. If `git config user.email` shows a personal address, set the noreply one for this repo before committing: `git config user.email purankuton2001@users.noreply.github.com`.
- A `Co-Authored-By: Claude <noreply@anthropic.com>` trailer is fine (CONTRIBUTING welcomes AI-assisted work). No other trailers, no model names, no session links.
- Commit messages describe the change to the project. They are not a diary: no reasons that involve the author's personal situation, no "decided on <date> to sell / partner / quit".

### Media and large files

- Old versions of binaries stay in history forever and make every clone heavier. Replace `docs/*.mp4`, `*.gif`, `*.png` only when the new version is final; do not iterate on media through commits (iterate in `out/`, which is gitignored, and commit once).
- Anything above a few MB that is not essential to the README belongs in a GitHub release asset or an unlisted YouTube upload, not in the tree.
- Strip metadata from media before committing (no EXIF, no author fields, no local paths in container metadata).

### Docs that live in the repo

`docs/REQUIREMENTS.md`, `docs/PERSONA-01.md`, `docs/LAUNCH.md` and `docs/GUIDE.md` are public documents. Write them as such: product decisions, measurements, procedures. Anything you would not say in a public issue comment does not go in.

## Working in this codebase

- Runtime: Node 20+, TypeScript, ESM. `npm install`, `cp .env.example .env`, `npm run dev` (mock backend, no keys needed).
- Before pushing: `npm run typecheck` and `npm test` must pass. Add a test in `test/` when touching `src/filter/`, `src/prompt/`, `src/reply/` or `src/server/http.ts`.
- Safety guards (`src/filter/`, `data/ip-names.txt`, `data/ng-words.txt`, `src/persona/facegen.ts`, `src/persona/voice.ts`) need a maintainer's review; see `.github/CODEOWNERS`. Never weaken them to make a test pass.
- The server listens on `127.0.0.1` only and refuses non-loopback `Host` headers and cross-origin POSTs. Keep it that way; do not add a `0.0.0.0` option or open CORS.
- Keys are read from `.env` in `src/config.ts` only. Never log them, never send them to `public/`, never put them in URLs (use headers).
- One change per PR. English in code and docs; Japanese and Korean are welcome in persona content and translations.
