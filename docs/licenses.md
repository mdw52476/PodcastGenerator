# Licenses

Everything bundled in or downloaded by this repo, and what its license means for us.
Checked 2026-10-03.

## Video engine

| Component | License | Notes |
|---|---|---|
| Remotion (`remotion`, `@remotion/*`) 4.0.532 | Remotion License (source-available) | **Free** for individuals and teams of up to **3 people**; commercial use allowed. See "Remotion terms" below. |
| Chrome Headless Shell | BSD-style (Chromium) | Downloaded by Remotion on first render into `node_modules`. |
| React, React DOM | MIT | |
| Zod | MIT | |

## Audio and alignment

| Component | License | Notes |
|---|---|---|
| ffmpeg (`ffmpeg-static`, gyan.dev "essentials" build 6.1.1) | GPL v3 (binary) | Run as a separate program for loudness, decoding and the proxy. We do not ship it inside another product, so GPL terms do not attach to our code. If we ever distribute the studio as an app, swap to an LGPL build. |
| faster-whisper | MIT | Supplies word *times* only; caption words come from the script. |
| Whisper `small.en` model (Systran CTranslate2 conversion of OpenAI Whisper) | MIT | Downloaded once into the Hugging Face cache (`%USERPROFILE%\.cache\huggingface`). |
| NumPy, SciPy | BSD-3-Clause | Music generator. |
| `packages/music/ambient_bed.py` | Ours | Approved by the owner. Beds it renders are ours. |

## Fonts (bundled in `packages/engine/public/fonts`)

| Font | Use | License |
|---|---|---|
| Oswald (variable) | Titles, end card | SIL OFL 1.1 (`Oswald-OFL.txt`) |
| Inter (variable) | Captions, disclosure, lower thirds | SIL OFL 1.1 (`Inter-OFL.txt`) |

Both fetched from https://github.com/google/fonts (`ofl/oswald`, `ofl/inter`).

## Remotion terms (read 2026-10-03, https://www.remotion.dev/docs/terms)

- **Automation is allowed on the Free License.** The terms state "Free License Users may build automations without purchasing Renders." Automation covers `renderMedia()` on a server (the Phase 2 Railway worker) and the `<Player>` (Phase 3 preview). Per-render fees apply only to Company License users.
- **Remotion Project** = any software that includes Remotion. Shoebox Studio, with all its shows, is one project.
- **Team size** counts people who operate the software on the project (own, control or use the codebase), including part-timers and contractors. People who only receive finished media do not count. AI coding agents (Claude Code etc.) are tools used by a person, not extra people.
- **Upgrade trigger:** 4+ people operating it -> Company License required (30-day grace to adjust). Options: Creators $25/seat/month (terms say no seat minimum; the pricing page said 3) or Automators $0.01/render, $100/month minimum. Internal renders count; development renders (localhost) and failed renders do not; Player playback is not a render.
- **Not applicable to us:** rendering-service rules (only when outside users upload their own Remotion code); exported-code attribution (only when users can download Remotion project code). Reselling or sublicensing the studio code itself is not allowed.
- Written confirmation requested from Remotion on 2026-10-03; file their reply here when it arrives.

## Dev tools

TypeScript (Apache-2.0), Vitest (MIT), tsx (MIT), pnpm (MIT).
