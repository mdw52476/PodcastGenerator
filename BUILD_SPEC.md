# Shoebox Studio: build spec

A code-based video studio for automated, story-driven video podcasts. It renders full episodes and vertical shorts from a JSON **edit plan**, and gives the owner a web UI to review, tweak, clip, and approve. First show: *The Shoebox Files* (true crime, narrated by the fictional Walt Harlan). The system must support more shows later via show profiles.

Owner: Matt Wolford. Built with Claude Code. Planned in claude.ai project "Pod workflow" (see `claude/studio/roadmap.md` there).

---

## 1. Why this exists (lessons from the EP01 test, Oct 3 2026)

The pilot used ElevenLabs (voice) + Descript (edit) + Canva (images) + Dropbox (files). It worked, but could not run unattended:

- **File handoff failed.** Dropbox temporary links are single-use; Descript's URL check consumed them. Claude's workspace could not upload to Descript storage. The owner had to drag files by hand.
- **Descript's AI editor** could not generate images, placed layers on timeline time instead of narration time, transcribed "Glen" as "Glenn" (wrong name in captions), could not do audio fades, and burned through the free AI credits in ~5 passes.
- **Canva** generates good stylized images, but only returns thumbnails to Claude; full-size files stay inside Canva.
- **Narration pace** matters: the owner rejected 171 wpm (too fast) and approved Bill at speed 0.88 (~140 wpm, conversational).

This studio replaces Descript entirely and removes every manual step.

---

## 2. Architecture

```
            ┌───────────────── Claude (pipeline skill) ─────────────────┐
            │ ideation → research → script → voice → EDIT PLAN (JSON)    │
            └──────────────────────────────┬─────────────────────────────┘
                                           │ writes plan + assets
                    ┌──────────────────────▼──────────────────────┐
  Owner ───────────►│  Web UI (Next.js on Vercel)                 │
  (browser)         │  board · timeline · preview · clips · approve│
                    └───────┬───────────────────────────┬─────────┘
                            │ reads/writes              │ "render" job
                    ┌───────▼─────────┐        ┌────────▼──────────────┐
                    │ Supabase        │◄──────►│ Render worker (Railway)│
                    │ Postgres + files│        │ Remotion + ffmpeg +    │
                    └─────────────────┘        │ Python (music)         │
                                               └────────┬──────────────┘
                                                        │ MP4s, shorts, thumbnails
                                                        ▼
                                            Supabase storage → Dropbox (owner copy)
```

**Core principle:** the edit plan is the single source of truth. The pipeline writes it, the UI edits it, the renderer renders it. The browser preview and the final render use the **same Remotion composition**, so what the owner sees is what renders.

### Stack (proposed; confirm before committing)
- **Language:** TypeScript everywhere except the music generator (Python).
- **Monorepo:** pnpm workspaces (or Turborepo).
- **Video engine:** Remotion. ⚠️ Check Remotion's license terms for this use (free tier applies to individuals/small companies) before building on it. If unsuitable, fall back to a pure ffmpeg renderer and a separate canvas-based preview.
- **UI:** Next.js (App Router) + Tailwind, deployed to Vercel. Remotion `<Player>` for previews.
- **Data/storage:** Supabase (Postgres, Storage, Auth for a single owner account).
- **Render worker:** Node service on Railway with Chromium (for Remotion), ffmpeg, Python 3 + numpy/scipy. Polls a `render_jobs` table (no extra queue infra for v1).
- **External APIs:** ElevenLabs (TTS with timestamps, music), Dropbox (deliver copies), later Metricool (publishing) and an image-generation API.
- **Fonts:** only SIL OFL / Apache licensed fonts, bundled in the repo.

### Repo layout
```
shoebox-studio/
  apps/
    web/            Next.js UI
    worker/         Railway render worker (Node + Python)
  packages/
    edit-plan/      Zod schema, types, validators, cue resolver
    engine/         Remotion compositions (episode 16:9, short 9:16, thumbnail)
    music/          ambient_bed.py and theme assets
    align/          word-timing alignment
    text-rules/     prime-directive checker (shared by UI + pipeline)
  fixtures/
    ep01/           real test episode: narration, script, edit plan, fact sheet
  docs/
```

---

## 3. The edit plan (contract)

A real example is in `fixtures/ep01/edit-plan.json`. Formalize it as a Zod schema in `packages/edit-plan` and version it (`schemaVersion`).

Key ideas:
- **Cue-based timing.** Shots, text, music and shorts are anchored to **cue phrases** from the script (e.g. `"cue": "Two months went by"`). A resolver maps each cue to a timestamp using word timings. Explicit `startSec` overrides a cue (the UI writes overrides when the owner drags things).
- **Captions use the script's spelling,** never a transcription. Alignment only supplies times.

Top-level fields (see fixture for full shape):
| Field | Purpose |
|---|---|
| `output` | width, height, fps, target loudness (-14 LUFS for YouTube), true peak |
| `narration` | audio file, duration, script text, `wordTimings` (array of `{word, start, end}`) |
| `style` | grade (saturation, contrast, teal/amber tint, vignette, grain, halation), crossfade length, fonts |
| `shots[]` | id, cue or startSec, visual (`image`/`video`, src, generation prompt), `motion` (`push_in`, `pull_out`, `drift_left`, `drift_right`, `pan_up`, `static`, `static_sway`), shotType |
| `text[]` | disclosure, title_card, episode_title, lower_third, end_card; cue or time; duration |
| `captions` | on/off, max lines, position, colors, mode (`word-highlight`) |
| `music[]` | track (`show-theme` or `bed:*` with generator params), cueStart/cueEnd, fades, duck level |
| `sfx[]` | optional one-shot sounds at cues |
| `shorts[]` | id, cueStart, cueEnd, optional hook text, per-shot crop overrides |

Validation must reject: unknown cues, overlapping text on the same layer, shots with no visual source at render time, any audience-facing text breaking the prime directives (§8).

---

## 4. Render engine (packages/engine + apps/worker)

### Episode (16:9, 1920×1080, 30 fps)
- **Shots:** full-frame image or video per shot, running from its cue to the next shot's cue. Motion presets as slow Ken Burns moves (max ~8% zoom over a shot; never fast). 0.5 s crossfades. Video clips loop or hold their last frame if short.
- **Grade:** consistent across shots: desaturate, teal shadows / amber highlights, contrast, vignette, animated film grain overlay, light halation. Implement as reusable layers so every show can define its own grade.
- **Captions:** word-highlight style, ≤2 lines, bottom-center, white with the active word in amber `#E8A33D`. Chunk lines at natural phrase breaks; never split a name.
- **Text cards:** show title, episode title, disclosure (first 10 s, lower-left, small), lower thirds, end card. Gentle fades only.
- **Audio:** narration; music tracks with fade in/out; **ducking computed from word timings** (music dips while Walt speaks, recovers in gaps); mixed, then a final ffmpeg `loudnorm` pass to -14 LUFS / -1.5 dBTP.
- **Output:** MP4 (H.264, AAC), plus a 720p proxy for fast review.

### Shorts (9:16, 1080×1920)
- Same composition, vertical preset: re-crop each shot (default center; per-shot `crop` override), bigger captions in the middle third (respect platform safe zones), optional hook text for the first 2–3 s, end card "Full story on The Shoebox Files". Clip boundaries snap to word/sentence edges. 15–60 s.

### Thumbnails
- 1280×720 still: chosen frame or image + 3–5 word headline in bold condensed type, amber accent, no faces.

### Worker behavior
- Poll `render_jobs`; render; upload outputs to Supabase Storage; optionally copy to the owner's Dropbox (`/Podcast Factory/<show>/<episode>/`); update job status and progress.
- Idempotent: re-running a job overwrites its outputs.

---

## 5. Word timing (packages/align)

Preferred: generate narration through the ElevenLabs **text-to-speech with timestamps** endpoint (returns character-level alignment) and convert to word timings. This also lets the studio voice episodes itself (no local MCP server needed).
Fallback for existing audio (like `fixtures/ep01/ep01-narration-v2.mp3`): forced alignment of the known script against the audio (pick a permissively licensed aligner). Output `{word, start, end}` using the **script's words**.

Voice settings for The Shoebox Files: voice Bill `pqHfZKP75CvOlQylNhV4`, model `eleven_multilingual_v2`, stability 0.35, similarity 0.8, style 0.2, speed 0.88. Chunk text at paragraph/scene breaks (<2,500 chars) so single sections can be re-voiced.

---

## 6. Music (packages/music)

- `ambient_bed.py` (approved by the owner) composes a dark ambient bed in code: A-minor pad through Am, Fmaj7, Dm9, Esus4; sub hum; sparse synthesized piano; reverb; hiss. Deterministic per `seed`.
- Generalize it: parameters for `duration`, `seed`, `key`/mode, `density` (piano note spacing), `brightness`, and a `lighter` preset. Beds are rendered to WAV by the worker and cached by parameter hash.
- **Show theme:** a separate fixed audio asset per show (to be produced later via ElevenLabs music on a paid plan or a musician). Until then, use a placeholder generated by `ambient_bed.py` with a distinct seed.

---

## 7. Web UI (apps/web)

Single owner account (Supabase Auth). Pages:

1. **Episode board:** cards by stage (idea → researched → scripted → voiced → edited → awaiting approval → approved → scheduled → published). Approve / request changes (free-text note saved to the episode).
2. **Episode editor:**
   - **Preview:** Remotion Player of the current plan (proxy quality).
   - **Timeline:** narration waveform with word markers; lanes for shots, text, captions, music. Drag shot edges (snap to words), swap a shot's image (upload or pick from library), change motion preset, edit text cards, move music cues, adjust duck/fades.
   - **Captions panel:** edit any word's display text; spellings persist into the plan.
   - **Script panel:** edit script text with live prime-directive checking (§8); "re-voice changed paragraphs" (ElevenLabs) updates audio + word timings and re-resolves cues.
   - **Render** button (full, proxy) with job progress; download links.
3. **Clipping studio:** auto-suggested short candidates (from plan `shorts[]` plus transcript heuristics: reveals, strong single lines, questions), each with a score (stands alone, hooks in 2 s, ends on a beat) and suggested hook text; adjust in/out on a word-snapping mini-timeline; per-shot vertical crop; platform preset (YouTube Shorts / TikTok / Reels); batch render; titles/descriptions/hashtags (prime-directive checked).
4. **Asset library:** images, video clips, music beds, show theme, fonts, logos; tags per show.
5. **Show settings:** the show profile as a form (narrator, opener/closer text, voice settings, grade, caption style, fonts, music presets, platforms, cadence). Adding a show = filling this form.

Design: dark UI, calm, information-dense; this is a tool, not a marketing site.

---

## 8. Text rules (packages/text-rules)

Every audience-facing string (captions come from narration; titles, descriptions, hooks, on-screen text) must pass the owner's prime directives:
1. No "not" or "n't" contractions outside quoted dialogue.
2. At most one "and" per sentence.
3. No em dashes (—).
Also flag the ai-tells vocabulary list (delve, tapestry, leverage, robust, navigate, foster, testament, journey, landscape, etc.). Expose as a function returning violations with positions, for UI highlighting and for the pipeline.

---

## 9. Integrations and secrets

Environment variables (never commit; use Vercel/Railway env settings):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ELEVENLABS_API_KEY`, `DROPBOX_APP_KEY`/`DROPBOX_REFRESH_TOKEN` (or OAuth), later `METRICOOL_*`, image-generation API key.
The ElevenLabs key currently used on the owner's laptop has a credit cap; a separate key for the worker is recommended.

---

## 10. Content guardrails the engine must respect

- Never show bodies, blood, wounds, weapons in use, identifiable real people, police insignia, logos, or readable text in generated/stock visuals (enforced in prompts and in a pre-render checklist in the UI).
- AI-content disclosure on screen in the first 10 s (show setting) and in descriptions.
- Nothing is published without the owner's explicit approval in the UI.

---

## 11. Build phases and acceptance criteria

**Phase 1: Engine + CLI (local).**
- `pnpm render --plan fixtures/ep01/edit-plan.json` produces a 16:9 MP4 of EP01 using the fixture narration, placeholder images (solid graded gradients or generated test frames are fine until real images exist), code-generated music beds, captions with correct "Glen" spelling, title cards, ducking, and -14 LUFS output.
- Alignment works on the fixture narration; every cue in the fixture resolves.
- Text-rules checker has unit tests (include the three directives and dialogue exemption).
- ✅ Done when the owner watches the EP01 render and approves the look.

**Phase 2: Deploy worker + storage.** Railway worker renders jobs from Supabase; outputs land in Supabase Storage and the owner's Dropbox.

**Phase 3: Episode board + preview + approve** (Vercel).

**Phase 4: Clipping studio** (vertical renders, batch shorts).

**Phase 5: Timeline editing + captions panel.**

**Phase 6: Script editing with selective re-voicing; show settings form; second show supported end to end.**

Later: image-generation API integration (stylized shots per show style), publishing via Metricool, performance feedback into clip suggestions, open-source TTS evaluation, optional export to a desktop editor format.

---

## 12. Fixtures provided

- `fixtures/ep01/ep01-narration-v2.mp3`: Bill narration, 6:43, approved pace.
- `fixtures/ep01/ep01-voiceover-v2.txt`: exact narration text (spelling source for captions).
- `fixtures/ep01/ep01-script-v2.md`: marked-up script with scene and shorts markers.
- `fixtures/ep01/edit-plan.json`: 27 cue-anchored shots with visual prompts, text cards, music plan, 5 shorts.
- `fixtures/ep01/ep01-fact-sheet.md`: sources (for the description).
- `fixtures/ambient_bed.py`: approved music generator.
- `fixtures/show-profile-the-shoebox-files.yaml`: show profile.

Images for the 27 shots do not exist yet as files; Phase 1 uses placeholders.
