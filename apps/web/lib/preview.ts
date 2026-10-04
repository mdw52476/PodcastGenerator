import type { ResolvedPlan } from "@shoebox/edit-plan";
import type { supabaseServer } from "./supabase/server";

type Supa = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * Load the preview bundle (props.json written by the worker) and swap its
 * relative asset paths for short-lived signed URLs the player can fetch.
 */
export async function loadPreview(supabase: Supa, episodeId: string): Promise<{ plan: ResolvedPlan; placeholderLabels: boolean } | null> {
  const prefix = `previews/${episodeId}`;
  const { data: blob } = await supabase.storage.from("studio").download(`${prefix}/props.json`);
  if (!blob) return null;
  const props = JSON.parse(await blob.text()) as { plan: ResolvedPlan; placeholderLabels: boolean };
  const plan = props.plan;
  const rels = [plan.narrationSrc, ...plan.music.map((m) => m.src), ...plan.shots.flatMap((s) => (s.src ? [s.src] : []))];
  const { data: signed } = await supabase.storage.from("studio").createSignedUrls(rels.map((r) => `${prefix}/${r}`), 6 * 3600);
  const url = new Map(rels.map((r, i) => [r, signed?.[i]?.signedUrl]));
  if (rels.some((r) => !url.get(r))) return null;
  plan.narrationSrc = url.get(plan.narrationSrc)!;
  for (const m of plan.music) m.src = url.get(m.src)!;
  for (const s of plan.shots) if (s.src) s.src = url.get(s.src)!;
  return props;
}
