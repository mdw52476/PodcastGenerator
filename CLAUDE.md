# Shoebox Studio: notes for Claude Code

Read `BUILD_SPEC.md` first. It is the source of truth for what to build and in what order.

## Working agreements
- Build in the phases in BUILD_SPEC.md §11. Finish and demo a phase before starting the next. Start with Phase 1 (engine + CLI, local only).
- Before adding Remotion, check its current license terms and tell the owner what they mean for this project; ask before committing to it.
- The edit plan (`packages/edit-plan`) is the contract between pipeline, UI and renderer. Change the schema deliberately, bump `schemaVersion`, and update `fixtures/ep01/edit-plan.json` to match.
- Test against the real fixture in `fixtures/ep01/`. The owner judges by watching renders, so produce a rendered file at the end of each phase.
- Captions take spelling from the script text, never from a transcription. The name is "Glen" (one n).
- All audience-facing text must pass `packages/text-rules` (no "not"/"n't" outside dialogue, max one "and" per sentence, no em dashes).
- Only bundle fonts, models, and assets with licenses that allow commercial use (OFL, Apache, MIT). Note each license in `docs/licenses.md`.
- Secrets go in environment variables only. Never commit keys.
- Prefer simple infrastructure: a Supabase table as the job queue, one Railway worker, one Vercel app.

## About the owner
Matt is not a professional developer. Explain choices in plain language, keep setup steps concrete (exact clicks and commands for Windows), and ask before anything that costs money or touches his accounts.

## Commands (fill in as they exist)
- Install: `pnpm install` (plus `python -m pip install --user numpy scipy faster-whisper`)
- Render fixture: `pnpm render --plan fixtures/ep01/edit-plan.json` (options: `--frames a-b`, `--out dir`, `--no-proxy`, `--no-labels`, `--strict`)
- Word timings: `pnpm align --plan fixtures/ep01/edit-plan.json`
- Text rules: `pnpm check-text <file>`
- Tests: `pnpm test`; types: `pnpm typecheck`
- pnpm lives in `%APPDATA%\npm` (user install; corepack needs admin on this machine).
