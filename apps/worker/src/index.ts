// Render worker: polls render_jobs, renders one job at a time, uploads outputs.
// Run locally with `pnpm worker` or on Railway (Dockerfile at repo root).
import { hostname } from "node:os";
import { dropboxConfigured } from "./dropbox";
import { optional } from "./env";
import { releaseJob, runJob } from "./runJob";
import { db, type RenderJob } from "./supabase";

const WORKER_ID = `${optional("RAILWAY_REPLICA_ID") ?? hostname()}-${process.pid}`;
const POLL_MS = Number(optional("POLL_SECONDS") ?? 10) * 1000;

let current: RenderJob | null = null;
let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down`);
  if (current) {
    console.log(`requeueing job ${current.id}`);
    await releaseJob(current);
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

async function claim(): Promise<RenderJob | null> {
  const { data, error } = await db().rpc("claim_render_job", { p_worker: WORKER_ID });
  if (error) throw new Error(`claim failed: ${error.message}`);
  const rows = (data ?? []) as RenderJob[];
  return rows[0] ?? null;
}

console.log(`worker ${WORKER_ID} started; polling every ${POLL_MS / 1000}s; Dropbox ${dropboxConfigured() ? "on" : "off"}`);
let idleSince = Date.now();
while (!stopping) {
  try {
    current = await claim();
    if (current) {
      console.log(`claimed job ${current.id} (${current.episode_id}, ${current.kind}, attempt ${current.attempts})`);
      await runJob(current);
      current = null;
      idleSince = Date.now();
      continue;
    }
    if (Date.now() - idleSince > 3600_000) {
      console.log("idle");
      idleSince = Date.now();
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
