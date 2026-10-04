"use server";
import { revalidatePath } from "next/cache";
import { paragraphsToVoice, scriptIssues, type WordTiming } from "@shoebox/edit-plan";
import { supabaseServer } from "@/lib/supabase/server";

/** Save the script text without voicing it. */
export async function saveScript(episodeId: string, script: string): Promise<void> {
  const supabase = await supabaseServer();
  const { error } = await supabase.from("episodes").update({ script }).eq("id", episodeId);
  if (error) throw new Error(error.message);
  revalidatePath(`/episodes/${episodeId}/script`);
}

/**
 * Queue a re-voice of the changed paragraphs. Checks the text rules first and
 * caps the job at the characters this edit needs, so it can't spend more.
 */
export async function queueRevoice(episodeId: string, script: string): Promise<{ characters: number; paragraphs: number }> {
  const issues = scriptIssues(script);
  if (issues.errors.length) throw new Error(`Fix these first: ${issues.errors.join(" ")}`);
  const supabase = await supabaseServer();
  const [{ data: ep, error }, { data: blob }] = await Promise.all([
    supabase.from("episodes").select("plan, assets").eq("id", episodeId).single(),
    supabase.storage.from("studio").download(`previews/${episodeId}/props.json`),
  ]);
  if (error) throw new Error(error.message);
  if (!blob) throw new Error("No preview bundle yet; refresh the preview first so the voiced script is known.");
  const words = JSON.parse(await blob.text()).plan.words as WordTiming[];
  const { toVoice, characters, ops } = paragraphsToVoice(words, script);
  if (!ops.some((o) => o.kind !== "keep")) throw new Error("Nothing changed since the last voicing.");
  const busy = await supabase.from("render_jobs").select("id").eq("episode_id", episodeId).in("kind", ["voice", "revoice"]).in("status", ["queued", "running"]).limit(1);
  if (busy.data?.length) throw new Error("A voice job for this episode is already running.");

  await saveScript(episodeId, script);
  const { error: insErr } = await supabase.from("render_jobs").insert({
    episode_id: episodeId,
    kind: "revoice",
    plan: ep.plan,
    assets: ep.assets ?? {},
    options: { script, maxCharacters: characters + 50 },
    max_attempts: 1,
  });
  if (insErr) throw new Error(insErr.message);
  revalidatePath(`/episodes/${episodeId}`);
  return { characters, paragraphs: toVoice.length };
}
