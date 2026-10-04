// pnpm job submit --plan fixtures/ep01/edit-plan.json [--prepare | --short short1 | --frames 0-899] [--replace-shorts] [--replace-edits] [--strict] [--no-labels] [--no-proxy] [--no-dropbox] [--watch]
// pnpm job watch [job-id]      (latest job if no id)
// pnpm job list
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { EditPlan, upgradePlan } from "@shoebox/edit-plan";
import { parseArgs } from "@shoebox/engine/pipeline";
import { db, objectExists, uploadFile, type RenderJob } from "./supabase";

const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
const args = parseArgs(rest);

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".json": "application/json", ".txt": "text/plain",
  ".md": "text/markdown", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".mp4": "video/mp4", ".mov": "video/quicktime",
};
const typeOf = (p: string) => CONTENT_TYPES[p.slice(p.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream";

/**
 * Timeline edits made in the web app (shot timing/motion/images, text cards, music
 * cues, caption fixes) live in the stored plan. Carry them over a re-submitted file
 * unless --replace-edits is passed.
 */
function keepWebEdits(raw: any, stored: any) {
  if (!stored) return;
  for (const key of ["shots", "text", "music"] as const) if (Array.isArray(stored[key])) raw[key] = stored[key];
  if (stored.captions?.overrides) raw.captions = { ...raw.captions, overrides: stored.captions.overrides };
}

async function submit() {
  if (typeof args.plan !== "string") throw new Error("usage: pnpm job submit --plan <edit-plan.json>");
  const planPath = resolve(args.plan);
  const planDir = dirname(planPath);
  const raw = upgradePlan(JSON.parse(readFileSync(planPath, "utf8")));
  const plan = EditPlan.parse(raw);

  // Every file the plan points at, relative to the plan.
  const rels = new Set<string>([plan.narration.audio, plan.narration.scriptText]);
  const timings = plan.narration.wordTimingsFile ?? "word-timings.json";
  if (existsSync(resolve(planDir, timings))) rels.add(timings);
  for (const s of plan.shots) if (s.visual.src) rels.add(s.visual.src);
  for (const s of plan.sfx ?? []) rels.add(s.src);

  // Content-addressed keys: unchanged files are uploaded once.
  const assets: Record<string, string> = {};
  for (const rel of rels) {
    const local = resolve(planDir, rel);
    if (!existsSync(local)) throw new Error(`plan references a missing file: ${rel}`);
    const hash = createHash("sha1").update(readFileSync(local)).digest("hex").slice(0, 12);
    const key = `inputs/${plan.episode.id}/${hash}-${basename(rel)}`;
    if (await objectExists(key)) console.log(`  have   ${rel}`);
    else {
      console.log(`  upload ${rel}`);
      await uploadFile(local, key, typeOf(rel));
    }
    assets[rel] = key;
  }

  // New episode: store the plan as-is. Existing episode: the web app owns its stage
  // and shorts, so keep those and take everything else from the file
  // (pass --replace-shorts to use the file's shorts instead).
  const { data: existing, error: getErr } = await db().from("episodes").select("plan, assets").eq("id", plan.episode.id).maybeSingle();
  if (getErr) throw new Error(`reading episode: ${getErr.message}`);
  if (existing) {
    const keepShorts = args["replace-shorts"] !== true && Array.isArray(existing.plan?.shorts);
    if (keepShorts) raw.shorts = upgradePlan(existing.plan).shorts;
    // Keep the plan's image paths pointing at images uploaded in the web app.
    Object.assign(assets, { ...(existing.assets ?? {}), ...assets });
    if (args["replace-edits"] !== true) keepWebEdits(raw, upgradePlan(existing.plan));
    const { error } = await db().from("episodes").update({ show: plan.show, title: plan.episode.title, plan: raw, assets }).eq("id", plan.episode.id);
    if (error) throw new Error(`saving episode: ${error.message}`);
    console.log(`  updated episode ${plan.episode.id} (stage unchanged${keepShorts ? ", shorts kept from the web app" : ""})`);
  } else {
    const { error } = await db().from("episodes").insert({ id: plan.episode.id, show: plan.show, title: plan.episode.title, status: plan.episode.status, plan: raw, assets });
    if (error) throw new Error(`saving episode: ${error.message}`);
    console.log(`  created episode ${plan.episode.id}`);
  }

  const frames = typeof args.frames === "string" ? (args.frames.split("-").map(Number) as [number, number]) : undefined;
  const { data, error } = await db()
    .from("render_jobs")
    .insert({
      episode_id: plan.episode.id,
      kind: args.prepare === true ? "prepare" : typeof args.short === "string" ? "short" : frames ? "preview" : "episode",
      plan: raw,
      assets,
      options: {
        frames,
        strict: args.strict === true,
        labels: args["no-labels"] !== true,
        proxy: args["no-proxy"] !== true,
        dropbox: args["no-dropbox"] !== true,
        ...(typeof args.short === "string" ? { shortId: args.short } : {}),
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`queueing job: ${error.message}`);
  console.log(`\nQueued job ${data.id}`);
  if (args.watch === true) await watch(data.id);
  else console.log(`Follow it with: pnpm job watch ${data.id}`);
}

const pct = (p: number) => `${Math.round(p * 100)}%`.padStart(4);

async function watch(id?: string) {
  let last = "";
  for (;;) {
    const q = db().from("render_jobs").select("*");
    const { data, error } = await (id ? q.eq("id", id).single() : q.order("created_at", { ascending: false }).limit(1).single());
    if (error) throw new Error(error.message);
    const j = data as RenderJob;
    const line = `${j.status.padEnd(9)} ${pct(j.progress)}  ${j.stage ?? ""}`;
    if (line !== last) console.log(`${new Date().toLocaleTimeString()}  ${line}`);
    last = line;
    if (j.status === "succeeded" && j.kind === "prepare") {
      console.log(`\nPreview ready: ${j.outputs?.preview}`);
      return;
    }
    if (j.status === "succeeded") {
      console.log(`\nDone in ${j.outputs?.renderSeconds}s. Loudness ${j.outputs?.loudness?.integrated} LUFS, true peak ${j.outputs?.loudness?.truePeak} dBTP.`);
      for (const k of ["master", "proxy"]) if (j.outputs?.[k]) console.log(`  ${k}: ${j.outputs[k].url}`);
      if (j.outputs?.dropbox) console.log(`  Dropbox (Apps/<your app>): ${j.outputs.dropbox.join(", ")}`);
      return;
    }
    if (j.status === "failed" || j.status === "cancelled") {
      console.log(`\n${j.status}: ${j.error ?? ""}`);
      process.exitCode = 1;
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

async function list() {
  const { data, error } = await db()
    .from("render_jobs")
    .select("id, episode_id, kind, status, progress, stage, created_at, error")
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  for (const j of data ?? [])
    console.log(`${j.id}  ${new Date(j.created_at).toLocaleString().padEnd(22)} ${j.episode_id.padEnd(12)} ${j.kind.padEnd(8)} ${j.status.padEnd(9)} ${pct(j.progress)} ${j.stage ?? ""}${j.error ? `  (${j.error.slice(0, 60)})` : ""}`);
}

try {
  if (command === "submit") await submit();
  else if (command === "watch") await watch(rest.find((a) => !a.startsWith("--")));
  else if (command === "list") await list();
  else console.log("usage: pnpm job <submit|watch|list> ...");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
