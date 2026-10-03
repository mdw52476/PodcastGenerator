import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { PlanError, renderEpisode, type RenderEvent } from "@shoebox/engine/pipeline";
import { dropboxConfigured, dropboxUpload } from "./dropbox";
import { optional } from "./env";
import { db, downloadFile, signedUrl, uploadFile, type RenderJob } from "./supabase";

const WORK_DIR = optional("WORK_DIR") ?? join(tmpdir(), "shoebox-jobs");
const log = (job: RenderJob, msg: string) => console.log(`[job ${job.id.slice(0, 8)}] ${msg}`);

async function update(job: RenderJob, fields: Partial<RenderJob> & { heartbeat_at?: string }) {
  const { error } = await db().from("render_jobs").update(fields).eq("id", job.id);
  if (error) console.error(`[job ${job.id.slice(0, 8)}] status update failed: ${error.message}`);
}

/** Storage prefix for a job's outputs. Re-running a job (or the same kind for the same episode) overwrites. */
export const outputPrefix = (job: RenderJob) => `renders/${job.episode_id}/${job.kind === "preview" ? "preview" : "episode"}`;

export async function runJob(job: RenderJob): Promise<void> {
  const dir = join(WORK_DIR, job.id);
  const inputDir = join(dir, "input");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(inputDir, { recursive: true });

  // Heartbeat: keeps the job claimed while long stages (render, loudness) run.
  let current: RenderEvent = { stage: "validate", progress: 0 };
  let lastWrite = 0;
  const beat = setInterval(() => void update(job, { heartbeat_at: new Date().toISOString(), stage: current.stage, progress: current.progress }), 30_000);

  try {
    // 1. inputs
    await update(job, { stage: "download", heartbeat_at: new Date().toISOString() });
    const planPath = join(inputDir, "edit-plan.json");
    writeFileSync(planPath, JSON.stringify(job.plan, null, 2));
    for (const [rel, key] of Object.entries(job.assets)) {
      log(job, `download ${key}`);
      await downloadFile(key, join(inputDir, rel));
    }

    // 2. render
    const result = await renderEpisode({
      planPath,
      outDir: join(dir, "out"),
      strict: job.options.strict === true,
      labels: job.options.labels !== false,
      frames: job.options.frames ?? null,
      proxy: job.options.proxy !== false,
      concurrency: optional("RENDER_CONCURRENCY") ? Number(optional("RENDER_CONCURRENCY")) : undefined,
      cacheDir: optional("MUSIC_CACHE_DIR"),
      onEvent: (e) => {
        current = e;
        if (e.message) log(job, e.message);
        if (Date.now() - lastWrite > 5000) {
          lastWrite = Date.now();
          void update(job, { stage: e.stage, progress: e.progress, heartbeat_at: new Date().toISOString() });
        }
      },
    });

    // 3. upload outputs
    await update(job, { stage: "upload", progress: 0.99, heartbeat_at: new Date().toISOString() });
    const prefix = outputPrefix(job);
    const files: Array<[string, string, string]> = [
      ["master", result.finalPath, "video/mp4"],
      ...(result.proxyPath ? [["proxy", result.proxyPath, "video/mp4"] as [string, string, string]] : []),
      ["report", result.reportPath, "application/json"],
    ];
    const outputs: Record<string, any> = {};
    for (const [name, path, type] of files) {
      const key = `${prefix}/${basename(path)}`;
      log(job, `upload ${key}`);
      await uploadFile(path, key, type);
      outputs[name] = { key, url: await signedUrl(key) };
    }

    // 4. owner copy in Dropbox (App folder): /<show>/<episode>/[previews/]
    if (job.options.dropbox !== false && dropboxConfigured()) {
      const base = `/${job.plan.show}/${job.episode_id}${job.kind === "preview" ? "/previews" : ""}`;
      outputs.dropbox = [];
      for (const [name, path] of files) {
        if (name === "report") continue;
        const target = `${base}/${basename(path)}`;
        log(job, `dropbox ${target}`);
        await dropboxUpload(path, target);
        outputs.dropbox.push(target);
      }
    } else if (job.options.dropbox !== false) {
      log(job, "Dropbox not configured; skipping owner copy");
    }

    outputs.loudness = result.loudness;
    outputs.renderSeconds = Math.round(result.seconds);
    await update(job, { status: "succeeded", stage: "done", progress: 1, outputs, finished_at: new Date().toISOString() });
    log(job, `succeeded in ${Math.round(result.seconds)}s`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A bad plan will fail the same way every time, so don't retry it.
    const retry = !(err instanceof PlanError) && job.attempts < 2;
    console.error(`[job ${job.id.slice(0, 8)}] ${retry ? "failed, will retry" : "failed"}: ${message}`);
    await update(job, {
      status: retry ? "queued" : "failed",
      error: message.slice(0, 4000),
      finished_at: retry ? null : new Date().toISOString(),
    });
  } finally {
    clearInterval(beat);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** On shutdown (Railway redeploy), hand the job back to the queue without using up an attempt. */
export async function releaseJob(job: RenderJob) {
  await update(job, { status: "queued", stage: null, attempts: Math.max(0, job.attempts - 1), error: "worker restarted; requeued" });
}
