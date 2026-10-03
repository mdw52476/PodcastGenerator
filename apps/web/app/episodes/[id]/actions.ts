"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { STAGES, type StageId } from "@/lib/stages";

async function current(episodeId: string) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("episodes").select("status").eq("id", episodeId).single();
  if (error) throw new Error(error.message);
  return { supabase, status: data.status as StageId };
}

async function move(episodeId: string, to: StageId, event: { kind: "status" | "approved" | "changes_requested"; body?: string }) {
  const { supabase, status } = await current(episodeId);
  if (status !== to) {
    const { error } = await supabase.from("episodes").update({ status: to }).eq("id", episodeId);
    if (error) throw new Error(error.message);
  }
  const { error } = await supabase
    .from("episode_events")
    .insert({ episode_id: episodeId, kind: event.kind, body: event.body || null, from_status: status, to_status: to });
  if (error) throw new Error(error.message);
  revalidatePath(`/episodes/${episodeId}`);
  revalidatePath("/");
}

export async function setStatus(episodeId: string, to: string) {
  if (!STAGES.some((s) => s.id === to)) throw new Error(`unknown stage ${to}`);
  await move(episodeId, to as StageId, { kind: "status" });
}

export async function approve(episodeId: string, note: string) {
  await move(episodeId, "approved", { kind: "approved", body: note.trim() });
}

/** Sends the episode back to "edited" with a note saying what to change. */
export async function requestChanges(episodeId: string, note: string) {
  if (!note.trim()) throw new Error("Say what should change.");
  await move(episodeId, "edited", { kind: "changes_requested", body: note.trim() });
}

export async function addNote(episodeId: string, note: string) {
  if (!note.trim()) return;
  const supabase = await supabaseServer();
  const { error } = await supabase.from("episode_events").insert({ episode_id: episodeId, kind: "note", body: note.trim() });
  if (error) throw new Error(error.message);
  revalidatePath(`/episodes/${episodeId}`);
}

/**
 * Queue a job on the Railway worker using the episode's current plan and the
 * input files uploaded with its most recent job.
 */
export async function queueJob(episodeId: string, kind: "episode" | "preview" | "prepare") {
  const supabase = await supabaseServer();
  const [{ data: ep, error: e1 }, { data: last, error: e2 }] = await Promise.all([
    supabase.from("episodes").select("plan").eq("id", episodeId).single(),
    supabase.from("render_jobs").select("assets").eq("episode_id", episodeId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (e1 || e2) throw new Error((e1 ?? e2)!.message);
  if (!ep?.plan || !last?.assets) throw new Error("This episode's files have not been uploaded yet. Submit it once with `pnpm job submit`.");

  // Quick test: 10 seconds from the opener, where titles, captions and music all show.
  const options = kind === "preview" ? { frames: [1230, 1529] } : {};
  const { error } = await supabase.from("render_jobs").insert({ episode_id: episodeId, kind, plan: ep.plan, assets: last.assets, options });
  if (error) throw new Error(error.message);
  revalidatePath(`/episodes/${episodeId}`);
}
