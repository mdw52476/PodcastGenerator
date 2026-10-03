# Shoebox Studio

Renders story-podcast episodes from a JSON edit plan. See `BUILD_SPEC.md` for the full design and `CLAUDE.md` for working rules.

**Status:** Phase 1 (engine + CLI, local).

## One-time setup (Windows)

You need Node.js 24 and Python 3.12 (both already on this laptop).

1. Open **PowerShell** in this folder (in File Explorer: click the address bar, type `powershell`, press Enter).
2. Install pnpm for your user (no admin needed):
   ```
   npm install -g pnpm@9
   ```
   Close and reopen PowerShell so the `pnpm` command is found.
3. Install the Python libraries for music and word timing:
   ```
   python -m pip install --user numpy scipy faster-whisper
   ```
4. Install the project's packages (this also fetches ffmpeg):
   ```
   pnpm install
   ```

The first render downloads Remotion's headless Chrome (~113 MB) and the first alignment downloads the Whisper `small.en` model (~500 MB). Both happen once.

## Everyday commands

| What | Command |
|---|---|
| Render an episode (1080p + 720p proxy) | `pnpm render --plan fixtures/ep01/edit-plan.json` |
| Quick test of a section (frames at 30 fps) | `pnpm render --plan fixtures/ep01/edit-plan.json --out out/test --frames 1230-1530 --no-proxy` |
| Render without the shot labels on placeholders | add `--no-labels` |
| Refuse to render if any shot lacks an image | add `--strict` |
| Re-time words after the narration changes | `pnpm align --plan fixtures/ep01/edit-plan.json` |
| Check text against the prime directives | `pnpm check-text path\to\file.txt` |
| Run tests | `pnpm test` |
| Open the interactive preview | `pnpm preview`, then load `out/<episode>/props.json` as props |

Output lands in `out/<episode-id>/`: `<id>.mp4` (final, -14 LUFS), `<id>-proxy-720p.mp4`, and `render-report.json` (loudness and any warnings).

## Layout

```
packages/
  edit-plan/   schema (Zod), cue resolver, caption chunker, ducking math
  text-rules/  prime-directive checker + CLI
  engine/      Remotion composition (Episode) + render/align scripts
  music/       ambient_bed.py (code-composed beds)
  align/       align.py (faster-whisper times, script words)
fixtures/ep01/ real test episode
docs/          licenses
```
