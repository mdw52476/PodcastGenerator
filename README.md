# Shoebox Studio

Renders story-podcast episodes from a JSON edit plan. See `BUILD_SPEC.md` for the full design and `CLAUDE.md` for working rules.

**Status:** Phase 6 (script editing with ElevenLabs re-voicing, show settings, multiple shows) on top of the local web app (board, preview, approve, clipping studio, timeline editor). Rendering runs on Railway; data and files on Supabase; copies to Dropbox.

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

## The web app (Phase 3)

Runs on this laptop. In PowerShell:

```
cd C:\Users\mdw52\VideoEditor\shoebox-studio
pnpm web
```

Then open **http://localhost:3000** (use `localhost`, not `127.0.0.1`, or the sign-in link won't match). Sign in with the email link. Leave the PowerShell window open while you use it; press Ctrl+C there to stop.

- **Board:** episodes in columns by stage. Click a card to open it.
- **Episode page:** live preview (the same composition the worker renders), stage picker, Approve / Request changes / notes, render buttons with progress and download links, history.
- **Refresh preview** rebuilds the preview bundle on Railway (~2 min). Full renders refresh it too.
- **Script** (button under the preview): edit the episode script with live text-rule checks. Changed, new and removed paragraphs are listed with the ElevenLabs characters a re-voice would use. **Re-voice changes** (after a confirmation) has Railway generate only those paragraphs, splice them into the narration (unchanged paragraphs keep their exact audio), shift timeline edits after the change, and refresh the preview. Voice jobs never retry on their own and refuse to run if ElevenLabs lacks the characters.
- **Shows** (top bar): one settings page per show (narrator, ElevenLabs voice and delivery, on-screen titles and disclosure, colour grade, caption colours, music bed, shorts end card and count, picture guardrails). **Add a show** copies another show's settings. **New episode from a script** voices a pasted script in the show's voice and builds a starting edit plan in its style (shots every ~8-15 s with placeholder pictures, titles, music, suggested shorts); it lands on the board as Edited.
- **Edit timeline** (button under the preview): the episode on a timeline. Voice waveform with word markers; lanes for shots, text cards, captions and music. Drag a shot's left edge to move the cut, drag text cards (or their right edge), drag music edges; everything snaps to word starts. Click a block to edit it on the right: shot camera move and picture (upload a JPG/PNG/WebP, pick an earlier upload, or go back to the placeholder), card text (text-rule checked), music fades / level / dip under the voice. The **Captions** tab fixes how any word displays (optionally every time it appears). Ctrl+Z / Ctrl+Y undo and redo. **Save** checks the plan and stores it; **Save & refresh preview** also rebuilds the preview's music on Railway (needed after moving music edges). Render from the episode page as usual.
- **Clipping studio** (button under the preview): vertical shorts. Pick a short or add one from the scored suggestions; trim by clicking the first and last words; set a hook, platform, per-shot crop, title, description and hashtags (all checked against the text rules); **Save**, then **Render** one or tick several and **Render selected**. Each short takes ~3 min on Railway and lands in `renders/<episode>/shorts/` and Dropbox `<show>/<episode>/shorts/`.
- Owner account: `pnpm owner:add <email>` (already done for mdw52476@gmail.com).

## Rendering in the cloud (Phase 2)

Your laptop only uploads inputs and queues the job; Railway renders it.

| What | Command |
|---|---|
| Render an episode on Railway | `pnpm job submit --plan fixtures/ep01/edit-plan.json --watch` |
| Quick cloud test (2 s) | `pnpm job submit --plan fixtures/ep01/edit-plan.json --frames 2400-2459 --watch` |
| Render one short on Railway | `pnpm job submit --plan fixtures/ep01/edit-plan.json --short short2 --watch` |
| Render one short on this laptop | `pnpm render --plan fixtures/ep01/edit-plan.json --short short2` |
| Rebuild the browser preview | `pnpm job submit --plan fixtures/ep01/edit-plan.json --prepare --watch` |

`pnpm job submit` on an existing episode updates its plan but keeps the stage and everything edited in the web app: shorts, shot timing/motion/images, text cards, music cues and caption fixes. Add `--replace-shorts` or `--replace-edits` to take those from the file instead.
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
  web/         Next.js web app (board, preview, approve); runs locally
  worker/      Railway render worker + job CLI + Dropbox setup
supabase/      database migrations
fixtures/ep01/ real test episode
docs/          licenses
```
