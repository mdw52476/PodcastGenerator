// pnpm render --plan fixtures/ep01/edit-plan.json [--out out/ep01] [--strict] [--no-labels]
//              [--frames 0-899] [--no-proxy] [--concurrency 4]
//
// 1. validate the plan and resolve every cue to seconds
// 2. generate (or reuse cached) music beds
// 3. render the Episode composition with Remotion
// 4. two-pass loudnorm to the plan's LUFS / true-peak target, then a 720p proxy
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { EditPlan, resolvePlan, type Issue, type MusicItem, type ResolvedPlan, type WordTiming } from "@shoebox/edit-plan";
import { alignNarration, ENGINE_DIR, FFMPEG, parseArgs, proxyArgs, PYTHON, REPO_DIR, run } from "./lib";

const args = parseArgs(process.argv.slice(2));
if (typeof args.plan !== "string") {
  console.error("usage: pnpm render --plan <edit-plan.json> [--out dir] [--strict] [--no-labels] [--frames a-b] [--no-proxy]");
  process.exit(1);
}
const started = Date.now();
const step = (msg: string) => console.log(`\n[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s] ${msg}`);

// ---------------------------------------------------------------- 1. plan
const planPath = resolve(args.plan);
const planDir = dirname(planPath);
const parsed = EditPlan.safeParse(JSON.parse(readFileSync(planPath, "utf8")));
if (!parsed.success) {
  console.error(`Edit plan is invalid:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  process.exit(1);
}
const plan = parsed.data;
const outDir = resolve(typeof args.out === "string" ? args.out : join(REPO_DIR, "out", plan.episode.id));
const publicDir = join(outDir, "public");
mkdirSync(publicDir, { recursive: true });

step(`Plan ${plan.episode.id}: "${plan.episode.title}"`);
const timingsPath = resolve(planDir, plan.narration.wordTimingsFile ?? "word-timings.json");
let words: WordTiming[] | undefined = plan.narration.wordTimings ?? undefined;
if (!words) {
  if (!existsSync(timingsPath)) {
    step("No word timings yet; aligning narration (a few minutes)");
    await alignNarration(resolve(planDir, plan.narration.audio), resolve(planDir, plan.narration.scriptText), timingsPath);
  }
  words = JSON.parse(readFileSync(timingsPath, "utf8")).words as WordTiming[];
}

const strict = args.strict === true;
const first = resolvePlan(plan, words, { allowPlaceholders: !strict });
report(first.issues);
if (first.issues.some((i) => i.level === "error")) {
  console.error("\nFix the errors above, then render again.");
  process.exit(1);
}

// ---------------------------------------------------------------- 2. music
step("Music beds");
const cacheDir = join(REPO_DIR, ".cache", "music");
mkdirSync(cacheDir, { recursive: true });
mkdirSync(join(publicDir, "music"), { recursive: true });

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
    console.log(`  generating ${m.track} (${p.duration}s, seed ${p.seed})`);
    await run(PYTHON, [join(REPO_DIR, "packages/music/ambient_bed.py"), ...cli]);
  } else console.log(`  cached ${m.track} (${p.duration}s, seed ${p.seed})`);
  const name = `music/${i}-${m.track.replace(/[^\w-]/g, "_")}-${hash}.wav`;
  copyFileSync(cached, join(publicDir, name));
  musicFiles.push(name);
}

// ---------------------------------------------------------------- assets + final resolve
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
const inputProps = { plan: resolved, placeholderLabels: args["no-labels"] !== true };
writeFileSync(join(outDir, "props.json"), JSON.stringify(inputProps));

// ---------------------------------------------------------------- 3. render
step("Bundling composition");
const serveUrl = await bundle({ entryPoint: join(ENGINE_DIR, "src/index.ts"), publicDir });
const composition = await selectComposition({ serveUrl, id: "Episode", inputProps });

const frameRange = typeof args.frames === "string" ? (args.frames.split("-").map(Number) as [number, number]) : null;
const id = plan.episode.id;
const rawPath = join(outDir, `${id}.raw.mp4`);
const finalPath = join(outDir, `${id}.mp4`);
const proxyPath = join(outDir, `${id}-proxy-720p.mp4`);
const concurrency = typeof args.concurrency === "string" ? Number(args.concurrency) : Math.max(1, Math.floor(cpus().length / 2));

step(`Rendering ${frameRange ? `frames ${frameRange[0]}-${frameRange[1]}` : `${composition.durationInFrames} frames`} at ${composition.width}x${composition.height}, concurrency ${concurrency}`);
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
  frameRange,
  onProgress: ({ progress, renderedFrames, encodedFrames }) => {
    const pct = Math.floor(progress * 100);
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      console.log(`  ${String(pct).padStart(3)}%  rendered ${renderedFrames}  encoded ${encodedFrames}`);
    }
  },
});

// ---------------------------------------------------------------- 4. loudness + proxy
step(`Loudness: two-pass loudnorm to ${plan.output.loudnessLUFS} LUFS / ${plan.output.truePeakDb} dBTP`);
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
const integrated = /I:\s+(-?[\d.]+) LUFS/.exec(check.slice(check.lastIndexOf("Summary")))?.[1];
const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(check.slice(check.lastIndexOf("Summary")))?.[1];
console.log(`  before: ${m.input_i} LUFS, ${m.input_tp} dBTP  ->  after: ${integrated} LUFS, true peak ${peak} dBTP`);

if (args["no-proxy"] !== true) {
  step("720p proxy");
  await run(FFMPEG, ["-hide_banner", "-y", ...proxyArgs(finalPath, proxyPath)]);
}
rmSync(rawPath);

writeFileSync(
  join(outDir, "render-report.json"),
  JSON.stringify({ plan: relative(REPO_DIR, planPath), renderedAt: new Date().toISOString(), seconds: (Date.now() - started) / 1000, loudness: { integrated, truePeak: peak }, issues: first.issues }, null, 2),
);
step(`Done.\n  ${finalPath}${args["no-proxy"] === true ? "" : `\n  ${proxyPath}`}`);

function report(issues: Issue[]) {
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const placeholders = warnings.filter((w) => w.message.includes("placeholder"));
  const other = warnings.filter((w) => !placeholders.includes(w));
  if (placeholders.length) console.log(`  ${placeholders.length} shots have no image yet; rendering placeholders (use --strict to fail instead)`);
  for (const w of other) console.log(`  warning ${w.where}: ${w.message}`);
  for (const e of errors) console.log(`  ERROR   ${e.where}: ${e.message}`);
  if (!errors.length) console.log(`  all cues resolved (${resolvedCount(first?.resolved)})`);
}
function resolvedCount(r?: ResolvedPlan) {
  return r ? `${r.shots.length} shots, ${r.text.length} text cards, ${r.music.length} music cues, ${r.shorts.length} shorts` : "";
}
