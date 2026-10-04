"use server";
import { revalidatePath } from "next/cache";
import { parsePlan, Short, type EditPlan } from "@shoebox/edit-plan";
import { checkText } from "@shoebox/text-rules";
import { supabaseServer } from "@/lib/supabase/server";

async function loadPlan(episodeId: string) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.from("episodes").select("plan, assets").eq("id", episodeId).single();
  if (error) throw new Error(error.message);
  const parsed = parsePlan(data.plan);
  if (!parsed.success) throw new Error(`Stored plan is invalid: ${parsed.error.issues[0]?.message}`);
  return { supabase, plan: parsed.data, assets: (data.assets ?? {}) as Record<string, string> };
}

/** Replace the plan's shorts. Rejects audience-facing text that breaks the prime directives. */
export async function saveShorts(episodeId: string, shorts: unknown[]): Promise<void> {
  const list = shorts.map((s) => Short.parse(s));
  const ids = new Set<string>();
  for (const s of list) {
    if (ids.has(s.id)) throw new Error(`Two shorts are called "${s.id}".`);
    ids.add(s.id);
    if (s.startSec !== undefined && s.endSec !== undefined && s.endSec <= s.startSec) throw new Error(`${s.id}: the end is before the start.`);
    for (const [field, value] of [["hook", s.hook], ["title", s.title], ["description", s.description]] as const) {
      const errs = value ? checkText(value).filter((v) => v.severity === "error") : [];
      if (errs.length) throw new Error(`${s.id} ${field}: ${errs.map((e) => e.message).join("; ")}`);
    }
  }
  const { supabase, plan } = await loadPlan(episodeId);
  const next: EditPlan = { ...plan, shorts: list };
  const { error } = await supabase.from("episodes").update({ plan: next }).eq("id", episodeId);
  if (error) throw new Error(error.message);
  revalidatePath(`/episodes/${episodeId}/clips`);
}

/** Queue one Railway job per short, using the saved plan and the episode's uploaded inputs. */
export async function queueShorts(episodeId: string, shortIds: string[]): Promise<void> {
  if (!shortIds.length) return;
  const { supabase, plan, assets: epAssets } = await loadPlan(episodeId);
  for (const id of shortIds) if (!plan.shorts.some((s) => s.id === id)) throw new Error(`Save before rendering: "${id}" is not in the saved plan.`);
  const { data: last, error: e2 } = await supabase
    .from("render_jobs")
    .select("assets")
    .eq("episode_id", episodeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e2) throw new Error(e2.message);
  const assets = { ...(last?.assets ?? {}), ...epAssets };
  if (!Object.keys(assets).length) throw new Error("This episode's files have not been uploaded yet. Submit it once with `pnpm job submit`.");
  const rows = shortIds.map((shortId) => ({ episode_id: episodeId, kind: "short", plan, assets, options: { shortId } }));
  const { error } = await supabase.from("render_jobs").insert(rows);
  if (error) throw new Error(error.message);
  revalidatePath(`/episodes/${episodeId}/clips`);
}
