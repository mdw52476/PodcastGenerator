// Voice and re-voice jobs: generate speech for new or changed paragraphs,
// rebuild the narration, carry the plan over, and refresh the preview.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assembleNarration,
  buildPlanFromDraft,
  buildPlanFromScript,
  Draft,
  draftIssues,
  diffParagraphs,
  joinParagraphs,
  parsePlan,
  remapPlan,
  scriptIssues,
  ShowProfile,
  splitParagraphs,
  voicedParagraphs,
  wordsFromAlignment,
  type AssembledNarration,
  type EditPlan,
  type GeneratedParagraph,
  type WordTiming,
} from "@shoebox/edit-plan";
import { FFMPEG, PlanError, run } from "@shoebox/engine/pipeline";
import { remainingCharacters, speak } from "./elevenlabs";
import { generateShotImages } from "./images";
import { optional } from "./env";
import { db, uploadFile, type RenderJob } from "./supabase";

const HARD_CAP = Number(optional("MAX_VOICE_CHARS_PER_JOB") ?? 20000);

/** Refuse before spending: over the per-job estimate, the hard cap, or the account's remaining characters. */
async function checkBudget(characters: number, allowed: number | undefined, log: (m: string) => void) {
  if (characters === 0) return;
  if (allowed !== undefined && characters > allowed) throw new PlanError(`This needs ${characters} characters but the job allowed ${allowed}. Start it again from the app.`);
  if (characters > HARD_CAP) throw new PlanError(`This needs ${characters} characters, over the worker's limit of ${HARD_CAP} per job.`);
  const left = await remainingCharacters();
  if (left === null) log("could not read the ElevenLabs balance (key has no User access); relying on the job limit");
  else if (characters > left) throw new PlanError(`ElevenLabs has ${left} characters left this period; this needs ${characters}. Upgrade the plan or wait for the monthly reset.`);
  else log(`ElevenLabs: using ${characters} of ${left} characters left`);
}

/** Generate the given paragraphs (index into `paras`) and turn each into a usable audio range + words. */
async function generate(paras: string[], indices: number[], voice: ShowProfile["voice"], dir: string, log: (m: string) => void) {
  const out = new Map<number, GeneratedParagraph & { file: string }>();
  for (const k of indices) {
    log(`voicing paragraph ${k + 1} (${paras[k].length} characters)`);
    const s = await speak(paras[k], voice, { previous: paras[k - 1], next: paras[k + 1] });
    const file = join(dir, `para-${k}.mp3`);
    writeFileSync(file, s.audio);
    const words = wordsFromAlignment(paras[k], s.alignment);
    // A hair of room so consonants at the edges are not clipped.
    const from = Math.max(0, words[0].start - 0.03);
    const to = words[words.length - 1].end + 0.08;
    out.set(k, { from, to, words, file });
  }
  return out;
}

/** Render the assembled narration to an MP3 with ffmpeg (exact cuts, silences, concat). */
export async function renderNarration(a: AssembledNarration, oldAudio: string | null, generated: Map<number, { file: string }>, outFile: string) {
  const inputs: string[] = [];
  const inputIndex = new Map<string, number>();
  const input = (f: string) => {
    if (!inputIndex.has(f)) {
      inputIndex.set(f, inputIndex.size);
      inputs.push("-i", f);
    }
    return inputIndex.get(f)!;
  };
  const fmt = "aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo";
  const parts: string[] = [];
  a.segments.forEach((s, n) => {
    if (s.source === "silence") parts.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${s.seconds.toFixed(4)},${fmt}[s${n}]`);
    else {
      const f = s.source === "old" ? oldAudio! : generated.get(s.paragraph)!.file;
      // apad + atrim pin every piece to exactly its planned length, even when the source file
      // ends a little before `to` (generated speech often stops right after the last word).
      const len = (s.to - s.from).toFixed(4);
      parts.push(`[${input(f)}:a]atrim=start=${s.from.toFixed(4)}:end=${s.to.toFixed(4)},asetpts=PTS-STARTPTS,${fmt},apad=whole_dur=${len},atrim=duration=${len}[s${n}]`);
    }
  });
  const graph = `${parts.join(";")};${a.segments.map((_, n) => `[s${n}]`).join("")}concat=n=${a.segments.length}:v=0:a=1[out]`;
  const graphFile = `${outFile}.filter.txt`;
  writeFileSync(graphFile, graph);
  await run(FFMPEG, ["-hide_banner", "-y", ...inputs, "-filter_complex_script", graphFile, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "192k", outFile]);
}

const hash = (s: string | Buffer) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** Upload new narration files and return their plan-relative paths and storage keys. */
async function uploadNarrationFiles(episodeId: string, dir: string, mp3: string, words: WordTiming[], durationSec: number, script: string) {
  const audioRel = `narration-${hash(readFileSync(mp3))}.mp3`;
  const timingsJson = JSON.stringify({ source: "elevenlabs with-timestamps + kept audio", durationSec, words });
  const timingsRel = `word-timings-${hash(timingsJson)}.json`;
  const scriptRel = `script-${hash(script)}.txt`;
  copyFileSync(mp3, join(dir, audioRel));
  writeFileSync(join(dir, timingsRel), timingsJson);
  writeFileSync(join(dir, scriptRel), script);
  const files: Array<[string, string, string]> = [
    [audioRel, join(dir, audioRel), "audio/mpeg"],
    [timingsRel, join(dir, timingsRel), "application/json"],
    [scriptRel, join(dir, scriptRel), "text/plain"],
  ];
  const assets: Record<string, string> = {};
  for (const [rel, path, type] of files) {
    const key = `inputs/${episodeId}/${rel}`;
    await uploadFile(path, key, type);
    assets[rel] = key;
  }
  return { audioRel, timingsRel, scriptRel, assets };
}

export interface VoiceResult {
  plan: EditPlan;
  profile: ShowProfile;
  /** Autopilot episode: images were generated and renders should follow. */
  autopilot: boolean;
  /** Directory holding the plan's files, ready for prepareEpisode. */
  dir: string;
  planPath: string;
  outputs: Record<string, unknown>;
}

/** Re-voice only the paragraphs that changed in options.script. */
export async function revoice(job: RenderJob, inputDir: string, log: (m: string) => void): Promise<VoiceResult> {
  const script = String((job.options as any).script ?? "");
  const issues = scriptIssues(script);
  if (issues.errors.length) throw new PlanError(`Script has text-rule problems:\n${issues.errors.join("\n")}`);
  const parsed = parsePlan(job.plan);
  if (!parsed.success) throw new PlanError(`plan is invalid: ${parsed.error.issues[0]?.message}`);
  const plan = parsed.data;
  const oldWords: WordTiming[] = JSON.parse(readFileSync(join(inputDir, plan.narration.wordTimingsFile ?? "word-timings.json"), "utf8")).words;
  const { data: ep } = await db().from("episodes").select("show").eq("id", job.episode_id).single();
  const profile = await loadProfile(ep!.show);

  const newParas = splitParagraphs(script);
  const ops = diffParagraphs(voicedParagraphs(oldWords).map((p) => p.text), newParas);
  const toVoice = ops.flatMap((o) => (o.kind === "replace" || o.kind === "insert" ? [o.newIndex] : []));
  const characters = toVoice.reduce((n, k) => n + newParas[k].length, 0);
  const changed = ops.filter((o) => o.kind !== "keep").length;
  if (!changed) throw new PlanError("The script matches the narration; nothing to re-voice.");
  await checkBudget(characters, (job.options as any).maxCharacters, log);

  const work = join(inputDir, "voice");
  mkdirSync(work, { recursive: true });
  const generated = await generate(newParas, toVoice, profile.voice, work, log);
  const assembled = assembleNarration(oldWords, plan.narration.durationSec, newParas, ops, generated);
  const mp3 = join(work, "narration.mp3");
  await renderNarration(assembled, join(inputDir, plan.narration.audio), generated, mp3);
  log(`narration rebuilt: ${plan.narration.durationSec.toFixed(1)} s -> ${assembled.durationSec.toFixed(1)} s`);

  const { plan: next, notes } = remapPlan(plan, oldWords, assembled);
  const finalScript = joinParagraphs(newParas);
  const up = await uploadNarrationFiles(job.episode_id, inputDir, mp3, assembled.words, assembled.durationSec, finalScript);
  next.narration.audio = up.audioRel;
  next.narration.wordTimingsFile = up.timingsRel;
  next.narration.scriptText = up.scriptRel;
  await saveEpisode(job.episode_id, next, finalScript, up.assets);
  for (const n of notes) log(n);

  const planPath = join(inputDir, "edit-plan.json");
  writeFileSync(planPath, JSON.stringify(next, null, 2));
  return { plan: next, profile, autopilot: false, dir: inputDir, planPath, outputs: { voicedParagraphs: toVoice.map((k) => k + 1), removedParagraphs: ops.filter((o) => o.kind === "delete").length, characters, notes, durationSec: assembled.durationSec } };
}

/** First narration for a new episode: voice every paragraph, then build a starter plan in the show's style. */
export async function voiceNew(job: RenderJob, inputDir: string, log: (m: string) => void): Promise<VoiceResult> {
  const o = job.options as any;
  const script = String(o.script ?? "");
  const issues = scriptIssues(script);
  if (issues.errors.length) throw new PlanError(`Script has text-rule problems:\n${issues.errors.join("\n")}`);
  const { data: ep } = await db().from("episodes").select("show, title, draft, autopilot").eq("id", job.episode_id).single();
  const profile = await loadProfile(ep!.show);
  // An autopilot draft brings its own shots, prompts and shorts; check it before spending anything.
  const draft = ep!.draft ? Draft.parse(ep!.draft) : null;
  if (draft) {
    const problems = draftIssues(draft);
    if (problems.length) throw new PlanError(`Draft has text-rule problems:\n${problems.join("\n")}`);
  }

  const paras = splitParagraphs(script);
  await checkBudget(paras.join("").length, o.maxCharacters, log);
  const work = join(inputDir, "voice");
  mkdirSync(work, { recursive: true });
  const all = paras.map((_, k) => k);
  const generated = await generate(paras, all, profile.voice, work, log);
  const ops = all.map((k) => ({ kind: "insert" as const, newIndex: k }));
  const assembled = assembleNarration([], 0, paras, ops, generated);
  const mp3 = join(work, "narration.mp3");
  await renderNarration(assembled, null, generated, mp3);
  log(`narration: ${assembled.durationSec.toFixed(1)} s`);

  const finalScript = joinParagraphs(paras);
  const up = await uploadNarrationFiles(job.episode_id, inputDir, mp3, assembled.words, assembled.durationSec, finalScript);
  const input = {
    showSlug: ep!.show,
    profile,
    episode: { id: job.episode_id, title: draft?.title ?? ep!.title },
    script: finalScript,
    words: assembled.words,
    durationSec: assembled.durationSec,
    files: { narration: up.audioRel, script: up.scriptRel, timings: up.timingsRel },
  };
  const built = draft ? buildPlanFromDraft(input, draft) : { plan: buildPlanFromScript(input), notes: [] as string[] };
  const plan = built.plan;
  for (const n of built.notes) log(n);

  // Autopilot: pictures for every shot (fal.ai), per the show setting.
  const autopilot = !!ep!.autopilot && !!(job.options as any).autopilot;
  let images = { assets: {} as Record<string, string>, generated: 0, failed: [] as string[] };
  if (autopilot) images = await generateShotImages(job.episode_id, plan, profile, inputDir, log);
  await saveEpisode(job.episode_id, plan, finalScript, { ...up.assets, ...images.assets }, "edited");

  const planPath = join(inputDir, "edit-plan.json");
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  return {
    plan,
    profile,
    autopilot,
    dir: inputDir,
    planPath,
    outputs: {
      voicedParagraphs: all.map((k) => k + 1),
      characters: paras.join("").length,
      durationSec: assembled.durationSec,
      shots: plan.shots.length,
      shorts: plan.shorts.length,
      images: images.generated,
      imagesFailed: images.failed,
      notes: built.notes,
    },
  };
}

async function loadProfile(showId: string): Promise<ShowProfile> {
  const { data, error } = await db().from("shows").select("profile").eq("id", showId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new PlanError(`Show "${showId}" has no settings yet; add it on the Shows page first.`);
  return ShowProfile.parse(data.profile);
}

async function saveEpisode(id: string, plan: EditPlan, script: string, newAssets: Record<string, string>, status?: string) {
  const { data } = await db().from("episodes").select("assets").eq("id", id).single();
  const assets = { ...((data?.assets ?? {}) as Record<string, string>), ...newAssets };
  const { error } = await db()
    .from("episodes")
    .update({ plan, script, assets, ...(status ? { status } : {}) })
    .eq("id", id);
  if (error) throw new Error(`saving episode: ${error.message}`);
}
