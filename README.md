# Shoebox Studio

Renders story-podcast episodes from a JSON edit plan. See `BUILD_SPEC.md` for the full design and `CLAUDE.md` for working rules.

**Status:** Phase 2 (cloud render worker on Railway, job queue + storage on Supabase, copies to Dropbox).

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

## Rendering in the cloud (Phase 2)

Your laptop only uploads inputs and queues the job; Railway renders it.

| What | Command |
|---|---|
| Render an episode on Railway | `pnpm job submit --plan fixtures/ep01/edit-plan.json --watch` |
| Quick cloud test (2 s) | `pnpm job submit --plan fixtures/ep01/edit-plan.json --frames 2400-2459 --watch` |
| Follow the latest job | `pnpm job watch` |
| Recent jobs | `pnpm job list` |
| Skip the Dropbox copy | add `--no-dropbox` |
| Run the worker on this laptop instead | `pnpm worker` (stop it afterwards so Railway gets the jobs) |
| Reconnect Dropbox | `pnpm dropbox-auth` (reads key/secret/code from `.env`) |

Finished files:
- **Supabase Storage**, bucket `studio`: `renders/<episode>/episode/` (full renders) or `renders/<episode>/preview/` (`--frames` tests). Re-rendering overwrites.
- **Dropbox**: `Apps/Shoebox Studio/<show>/<episode>/` (previews in a `previews/` subfolder).

Where things live:
- Supabase project `shoebox-studio` (ref `tfjoqdcysltgmggeyryd`): tables `episodes`, `render_jobs`; schema in `supabase/migrations/`.
- Railway project `shoebox-studio`, service `render-worker` (8 vCPU / 8 GB cap). Deploys automatically on every push to `main` on GitHub (`mdw52476/PodcastGenerator`). Settings come from its Variables tab (same names as `.env.example`).

## Layout

```
packages/
  edit-plan/   schema (Zod), cue resolver, caption chunker, ducking math
  text-rules/  prime-directive checker + CLI
  engine/      Remotion composition (Episode) + render/align scripts
  music/       ambient_bed.py (code-composed beds)
  align/       align.py (faster-whisper times, script words)
apps/
  worker/      Railway render worker + job CLI + Dropbox setup
supabase/      database migrations
fixtures/ep01/ real test episode
docs/          licenses
```
