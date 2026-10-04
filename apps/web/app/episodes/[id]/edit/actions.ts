"use server";
import { revalidatePath } from "next/cache";
import { EditPlan, parsePlan, resolvePlan, type WordTiming } from "@shoebox/edit-plan";
import { checkText } from "@shoebox/text-rules";
import { supabaseServer } from "@/lib/supabase/server";

export interface PlanEdits {
  shots: EditPlan["shots"];
  text: EditPlan["text"];
  music: EditPlan["music"];
  captionOverrides: Record<string, string>;
}

/**
 * Save timeline edits into the stored plan. Shorts and everything else in the
 * plan are left as they are. Rejects anything that would not render:
 * schema errors, unknown cues, overlapping text, text-rule errors on screen text.
 */
export async function savePlanEdits(episodeId: string, edits: PlanEdits): Promise<{ warnings: string[] }> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("episodes").select("plan").eq("id", episodeId).single();
  if (error) throw new Error(error.message);
  const stored = parsePlan(data.plan);
  if (!stored.success) throw new Error(`Stored plan is invalid: ${stored.error.issues[0]?.message}`);

  const next = EditPlan.safeParse({
    ...stored.data,
    shots: edits.shots,
    text: edits.text,
    music: edits.music,
    captions: { ...stored.data.captions, overrides: Object.keys(edits.captionOverrides).length ? edits.captionOverrides : undefined },
  });
  if (!next.success) throw new Error(`Not saved: ${next.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);

  for (const t of next.data.text) {
    const errs = checkText(t.text).filter((v) => v.severity === "error");
    if (errs.length) throw new Error(`Not saved: "${t.text}" breaks the text rules (${errs.map((e) => e.message).join("; ")}).`);
  }

  // Resolve against the real word timings so a bad cue or an overlap can't reach the renderer.
  const { data: blob } = await supabase.storage.from("studio").download(`previews/${episodeId}/props.json`);
  if (blob) {
    const words = (JSON.parse(await blob.text()).plan.words ?? []) as WordTiming[];
    if (words.length) {
      const { issues } = resolvePlan(next.data, words, { allowPlaceholders: true });
      const errors = issues.filter((i) => i.level === "error");
      if (errors.length) throw new Error(`Not saved: ${errors.map((e) => `${e.where}: ${e.message}`).join("; ")}`);
    }
  }

  const { error: upErr } = await supabase.from("episodes").update({ plan: next.data }).eq("id", episodeId);
  if (upErr) throw new Error(upErr.message);
  revalidatePath(`/episodes/${episodeId}`);
  revalidatePath(`/episodes/${episodeId}/edit`);
  return { warnings: [] };
}

/** Record an image the browser just uploaded to inputs/<episode>/images/, so renders download it. */
export async function registerImage(episodeId: string, rel: string, key: string): Promise<void> {
  if (!/^images\/[\w.-]+$/.test(rel) || !key.startsWith(`inputs/${episodeId}/images/`)) throw new Error("Unexpected image path.");
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("episodes").select("assets").eq("id", episodeId).single();
  if (error) throw new Error(error.message);
  const assets = { ...((data.assets ?? {}) as Record<string, string>), [rel]: key };
  const { error: upErr } = await supabase.from("episodes").update({ assets }).eq("id", episodeId);
  if (upErr) throw new Error(upErr.message);
}
