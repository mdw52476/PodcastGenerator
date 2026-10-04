// The full episode pipeline, shared by the local CLI and the Railway worker:
// 1. validate the plan and resolve every cue to seconds
// 2. generate (or reuse cached) music beds
// 3. render the Episode composition with Remotion
// 4. two-pass loudnorm to the plan's LUFS / true-peak target, then a 720p proxy
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { EditPlan, parsePlan, resolvePlan, resolveShort, type Issue, type MusicItem, type ResolvedPlan, type WordTiming } from "@shoebox/edit-plan";
import { alignNarration, ENGINE_DIR, FFMPEG, proxyArgs, PYTHON, REPO_DIR, run } from "./lib";

export type Stage = "validate" | "align" | "music" | "bundle" | "render" | "loudness" | "proxy" | "done";

export interface RenderEvent {
  stage: Stage;
  /** 0..1 across the whole pipeline. */
  progress: number;
  message?: string;
}

export interface RenderOptions {
  planPath: string;
  outDir: string;
  /** Fail when a shot has no image instead of rendering a placeholder. */
  strict?: boolean;
  /** Show shot id + prompt on placeholder frames. */
  labels?: boolean;
  frames?: [number, number] | null;
  proxy?: boolean;
  concurrency?: number;
  /** Where generated music beds are cached between renders. */
  cacheDir?: string;
  onEvent?: (e: RenderEvent) => void;
}

export interface RenderResult {
  episodeId: string;
  finalPath: string;
  proxyPath: string | null;
  reportPath: string;
  issues: Issue[];
  loudness: { integrated?: string; truePeak?: string };
  seconds: number;
  /** The prepared inputs, e.g. for exportPreviewBundle. */
  prepared: Prepared;
}

export class PlanError extends Error {
  constructor(message: string, readonly issues: Issue[] = []) {
    super(message);
  }
}

// Rough share of total wall time per stage, for one overall progress number.
const WEIGHTS: Record<Stage, [number, number]> = {
  validate: [0, 0.01],
  align: [0.01, 0.05],
  music: [0.05, 0.08],
  bundle: [0.08, 0.1],
  render: [0.1, 0.92],
  loudness: [0.92, 0.97],
  proxy: [0.97, 1],
  done: [1, 1],
};

export interface Prepared {
  plan: EditPlan;
  outDir: string;
  /** Everything the composition loads: fonts, narration, music beds, shot images. */
  publicDir: string;
  inputProps: { plan: ResolvedPlan; placeholderLabels: boolean };
  issues: Issue[];
  started: number;
  emit: (stage: Stage, within?: number, message?: string) => void;
}

/** Steps 1-2: validate, resolve cues, generate music, gather assets. No video is rendered. */
export async function prepareEpisode(o: RenderOptions): Promise<Prepared> {
  const started = Date.now();
  const emit = (stage: Stage, within = 0, message?: string) => {
    const [a, b] = WEIGHTS[stage];
    o.onEvent?.({ stage, progress: a + (b - a) * Math.min(1, Math.max(0, within)), message });
  };

  // ------------------------------------------------------------ 1. plan
  emit("validate");
  const planPath = resolve(o.planPath);
  const planDir = dirname(planPath);
  const parsed = parsePlan(JSON.parse(readFileSync(planPath, "utf8")));
  if (!parsed.success) {
    throw new PlanError(`Edit plan is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  const plan = parsed.data;
  const outDir = resolve(o.outDir);
  const publicDir = join(outDir, "public");
  mkdirSync(publicDir, { recursive: true });
  emit("validate", 0, `Plan ${plan.episode.id}: "${plan.episode.title}"`);

  const timingsPath = resolve(planDir, plan.narration.wordTimingsFile ?? "word-timings.json");
  let words: WordTiming[] | undefined = plan.narration.wordTimings ?? undefined;
  if (!words) {
    if (!existsSync(timingsPath)) {
      emit("align", 0, "No word timings yet; aligning narration (a few minutes)");
      await alignNarration(resolve(planDir, plan.narration.audio), resolve(planDir, plan.narration.scriptText), timingsPath);
    }
    words = JSON.parse(readFileSync(timingsPath, "utf8")).words as WordTiming[];
  }

  const strict = o.strict === true;
  const first = resolvePlan(plan, words, { allowPlaceholders: !strict });
  const errors = first.issues.filter((i) => i.level === "error");
  if (errors.length) {
    throw new PlanError(`Plan has ${errors.length} error(s):\n${errors.map((e) => `  ${e.where}: ${e.message}`).join("\n")}`, first.issues);
  }
  const placeholders = first.issues.filter((i) => i.message.includes("placeholder")).length;
  if (placeholders) emit("validate", 1, `${placeholders} shots have no image yet; rendering placeholders`);
  for (const w of first.issues.filter((i) => i.level === "warning" && !i.message.includes("placeholder")))
    emit("validate", 1, `warning ${w.where}: ${w.message}`);

  // ------------------------------------------------------------ 2. music
  emit("music", 0, "Music beds");
  const cacheDir = o.cacheDir ?? join(REPO_DIR, ".cache", "music");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(join(publicDir, "music"), { recursive: true });
  const musicFiles: string[] = [];
  for (const [i, m] of plan.music.entries()) {
    const r = first.resolved.music[i];
    const p = bedParams(m, r.end + r.fadeOutSec - r.start);
    const hash = createHash("sha1").update(JSON.stringify(p)).digest("hex").slice(0, 12);
    const cached = join(cacheDir, `${hash}.wav`);
    if (!existsSync(cached)) {
      const cli = ["--out", cached, "--duration", String(p.duration), "--seed", String(p.seed), "--preset", p.preset, "--fade-in", "0", "--fade-out", "0"];
      if (p.key) cli.push("--key", p.key);
      if (p.density) cli.push("--density", p.density);
      if (p.brightness) cli.push("--brightness", String(p.brightness));
      emit("music", i / plan.music.length, `generating ${m.track} (${p.duration}s, seed ${p.seed})`);
      await run(PYTHON, [join(REPO_DIR, "packages/music/ambient_bed.py"), ...cli]);
    } else emit("music", i / plan.music.length, `cached ${m.track} (${p.duration}s, seed ${p.seed})`);
    const name = `music/${i}-${m.track.replace(/[^\w-]/g, "_")}-${hash}.wav`;
    copyFileSync(cached, join(publicDir, name));
    musicFiles.push(name);
  }

  // ------------------------------------------------------------ assets + final resolve
  cpSync(join(ENGINE_DIR, "public", "fonts"), join(publicDir, "fonts"), { recursive: true });
  const narrationName = `narration/${basename(plan.narration.audio)}`;
  mkdirSync(join(publicDir, "narration"), { recursive: true });
  copyFileSync(resolve(planDir, plan.narration.audio), join(publicDir, narrationName));
  const planForRender = structuredClone(plan);
  planForRender.narration.audio = narrationName;
  for (const s of planForRender.shots) {
    if (!s.visual.src) continue;
    const name = `shots/${s.id}-${basename(s.visual.src)}`;
    mkdirSync(join(publicDir, "shots"), { recursive: true });
    copyFileSync(resolve(planDir, s.visual.src), join(publicDir, name));
    s.visual.src = name;
  }
  const { resolved } = resolvePlan(planForRender, words, { allowPlaceholders: !strict, musicSrc: (_m, i) => musicFiles[i] });
  const inputProps = { plan: resolved, placeholderLabels: o.labels !== false };
  writeFileSync(join(outDir, "props.json"), JSON.stringify(inputProps));
  return { plan, outDir, publicDir, inputProps, issues: first.issues, started, emit };
}

/**
 * Package what the browser preview (Remotion Player) needs: props.json with asset
 * paths relative to the bundle, narration, shot images, and music beds as AAC
 * (the WAV beds are ~25 MB each; the preview only needs ~2 MB).
 * Fonts are not included; the web app serves its own copies.
 */
export async function exportPreviewBundle(p: Prepared, bundleDir: string): Promise<string[]> {
  rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });
  const props = structuredClone(p.inputProps);
  const files: string[] = [];
  const copy = (rel: string) => {
    mkdirSync(dirname(join(bundleDir, rel)), { recursive: true });
    copyFileSync(join(p.publicDir, rel), join(bundleDir, rel));
    files.push(rel);
  };
  copy(props.plan.narrationSrc);
  for (const s of props.plan.shots) if (s.src) copy(s.src);
  for (const m of props.plan.music) {
    const rel = m.src.replace(/\.wav$/, ".m4a");
    mkdirSync(dirname(join(bundleDir, rel)), { recursive: true });
    await run(FFMPEG, ["-hide_banner", "-y", "-i", join(p.publicDir, m.src), "-c:a", "aac", "-b:a", "128k", join(bundleDir, rel)]);
    m.src = rel;
    files.push(rel);
  }
  writeFileSync(join(bundleDir, "props.json"), JSON.stringify(props));
  files.push("props.json");
  return files;
}

export async function renderEpisode(o: RenderOptions): Promise<RenderResult> {
  const prepared = await prepareEpisode(o);
  const { plan, outDir, inputProps, started, emit } = prepared;

  const id = plan.episode.id;
  const rawPath = join(outDir, `${id}.raw.mp4`);
  const finalPath = join(outDir, `${id}.mp4`);
  const proxyPath = join(outDir, `${id}-proxy-720p.mp4`);
  const frames = o.frames ?? null;

  await renderComposition(prepared, "Episode", inputProps, rawPath, o);
  const loudness = await normalizeLoudness(rawPath, finalPath, plan, emit);

  let proxy: string | null = null;
  if (o.proxy !== false) {
    emit("proxy", 0, "720p proxy");
    await run(FFMPEG, ["-hide_banner", "-y", ...proxyArgs(finalPath, proxyPath)]);
    proxy = proxyPath;
  }
  rmSync(rawPath);

  const seconds = (Date.now() - started) / 1000;
  const reportPath = join(outDir, "render-report.json");
  writeFileSync(
    reportPath,
    JSON.stringify({ episode: id, renderedAt: new Date().toISOString(), seconds, frames, loudness, issues: prepared.issues }, null, 2),
  );
  emit("done", 1, "Done");
  return { episodeId: id, finalPath, proxyPath: proxy, reportPath, issues: prepared.issues, loudness, seconds, prepared };
}

/** A vertical short cut from the episode: same music, grade and timing, 9:16 frame. */
export async function renderShort(o: RenderOptions & { shortId: string }): Promise<RenderResult> {
  const prepared = await prepareEpisode(o);
  const { plan, outDir, inputProps, started, emit } = prepared;
  const props = resolveShort(inputProps.plan, o.shortId, { placeholderLabels: inputProps.placeholderLabels });
  const s = props.short;
  const clipSec = s.end - s.start;
  if (clipSec > props.preset.maxSec || clipSec < props.preset.minSec)
    emit("validate", 1, `warning: ${o.shortId} is ${clipSec.toFixed(1)}s; ${props.preset.label} expects ${props.preset.minSec}-${props.preset.maxSec}s`);

  const id = `${plan.episode.id}-${o.shortId}`;
  const rawPath = join(outDir, `${id}.raw.mp4`);
  const finalPath = join(outDir, `${id}.mp4`);
  await renderComposition(prepared, "Short", props, rawPath, o);
  const loudness = await normalizeLoudness(rawPath, finalPath, plan, emit);
  rmSync(rawPath);

  const seconds = (Date.now() - started) / 1000;
  const reportPath = join(outDir, `${id}-report.json`);
  writeFileSync(
    reportPath,
    JSON.stringify({ episode: plan.episode.id, short: o.shortId, platform: props.preset.id, window: [s.start, s.end], renderedAt: new Date().toISOString(), seconds, loudness, issues: prepared.issues }, null, 2),
  );
  emit("done", 1, "Done");
  return { episodeId: plan.episode.id, finalPath, proxyPath: null, reportPath, issues: prepared.issues, loudness, seconds, prepared };
}

async function renderComposition(p: Prepared, compositionId: "Episode" | "Short", inputProps: Record<string, unknown>, rawPath: string, o: RenderOptions) {
  p.emit("bundle", 0, "Bundling composition");
  const serveUrl = await bundle({ entryPoint: join(ENGINE_DIR, "src/index.ts"), publicDir: p.publicDir });
  const composition = await selectComposition({ serveUrl, id: compositionId, inputProps });
  const concurrency = o.concurrency ?? Math.max(1, Math.floor(cpus().length / 2));
  const frames = o.frames ?? null;

  p.emit("render", 0, `Rendering ${frames ? `frames ${frames[0]}-${frames[1]}` : `${composition.durationInFrames} frames`} at ${composition.width}x${composition.height}, concurrency ${concurrency}`);
  let lastPct = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: rawPath,
    inputProps,
    crf: 18,
    audioCodec: "aac",
    audioBitrate: "320k",
    concurrency,
    frameRange: frames,
    onProgress: ({ progress, renderedFrames, encodedFrames }) => {
      const pct = Math.floor(progress * 100);
      if (pct !== lastPct) {
        lastPct = pct;
        p.emit("render", progress, pct % 5 === 0 ? `${String(pct).padStart(3)}%  rendered ${renderedFrames}  encoded ${encodedFrames}` : undefined);
      }
    },
  });
}

/** Two-pass loudnorm to the plan's target; video is copied untouched. */
async function normalizeLoudness(rawPath: string, finalPath: string, plan: EditPlan, emit: Prepared["emit"]) {
  emit("loudness", 0, `Loudness: two-pass loudnorm to ${plan.output.loudnessLUFS} LUFS / ${plan.output.truePeakDb} dBTP`);
  const target = `I=${plan.output.loudnessLUFS}:TP=${plan.output.truePeakDb}:LRA=11`;
  const pass1 = await run(FFMPEG, ["-hide_banner", "-i", rawPath, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
  const m = JSON.parse(pass1.slice(pass1.lastIndexOf("{"), pass1.lastIndexOf("}") + 1));
  const af =
    `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}` +
    `:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true:print_format=json`;
  const tmp = finalPath.replace(/\.mp4$/, ".tmp.mp4");
  await run(FFMPEG, ["-hide_banner", "-y", "-i", rawPath, "-c:v", "copy", "-af", af, "-ar", "48000", "-c:a", "aac", "-b:a", "320k", "-movflags", "+faststart", tmp]);
  renameSync(tmp, finalPath);

  const check = await run(FFMPEG, ["-hide_banner", "-i", finalPath, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const summary = check.slice(check.lastIndexOf("Summary"));
  const loudness = { integrated: /I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1], truePeak: /Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1] };
  emit("loudness", 1, `before: ${m.input_i} LUFS, ${m.input_tp} dBTP  ->  after: ${loudness.integrated} LUFS, true peak ${loudness.truePeak} dBTP`);
  return loudness;
}

/** Generator parameters for a music item. show-theme is a placeholder bed until a real theme exists. */
function bedParams(m: MusicItem, durationSec: number) {
  const g = m.generator;
  const isTheme = m.track === "show-theme";
  const preset = m.track === "bed:lighter" ? "lighter" : "dark";
  return {
    duration: Math.ceil(durationSec + 1),
    seed: isTheme ? 101 : g?.seed ?? 7,
    preset,
    key: g?.key,
    density: g?.density ?? (isTheme ? "normal" : undefined),
    brightness: g?.brightness ?? (isTheme ? 1.15 : undefined),
  };
}
