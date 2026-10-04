import type { ResolvedPlan } from "@shoebox/edit-plan";
import type { supabaseServer } from "./supabase/server";

type Supa = Awaited<ReturnType<typeof supabaseServer>>;
const HOURS = 6 * 3600;

export interface PreviewBundle {
  /** Resolved plan as written by the worker; asset paths relative to the bundle. */
  plan: ResolvedPlan;
  placeholderLabels: boolean;
  /** Signed URLs: narration, music by index, and bundle shot images by relative path. */
  urls: { narration: string; music: string[]; shots: Record<string, string> };
}

/** The preview bundle (props.json written by the worker) plus signed URLs for its files. */
export async function loadPreviewBundle(supabase: Supa, episodeId: string): Promise<PreviewBundle | null> {
  const prefix = `previews/${episodeId}`;
  const { data: blob } = await supabase.storage.from("studio").download(`${prefix}/props.json`);
  if (!blob) return null;
  const props = JSON.parse(await blob.text()) as { plan: ResolvedPlan; placeholderLabels: boolean };
  const plan = props.plan;
  const shotRels = plan.shots.flatMap((s) => (s.src ? [s.src] : []));
  const rels = [plan.narrationSrc, ...plan.music.map((m) => m.src), ...shotRels];
  const { data: signed } = await supabase.storage.from("studio").createSignedUrls(rels.map((r) => `${prefix}/${r}`), HOURS);
  const url = new Map(rels.map((r, i) => [r, signed?.[i]?.signedUrl]));
  if (rels.some((r) => !url.get(r))) return null;
  return {
    plan,
    placeholderLabels: props.placeholderLabels,
    urls: {
      narration: url.get(plan.narrationSrc)!,
      music: plan.music.map((m) => url.get(m.src)!),
      shots: Object.fromEntries(shotRels.map((r) => [r, url.get(r)!])),
    },
  };
}

/** The bundle's plan with every asset path swapped for a signed URL, ready for the player. */
export async function loadPreview(supabase: Supa, episodeId: string): Promise<{ plan: ResolvedPlan; placeholderLabels: boolean } | null> {
  const b = await loadPreviewBundle(supabase, episodeId);
  if (!b) return null;
  const plan = b.plan;
  plan.narrationSrc = b.urls.narration;
  plan.music.forEach((m, i) => (m.src = b.urls.music[i]));
  for (const s of plan.shots) if (s.src) s.src = b.urls.shots[s.src];
  return { plan, placeholderLabels: b.placeholderLabels };
}

/** Signed URLs for images uploaded to this episode, keyed by their plan-relative path ("images/..."). */
export async function signEpisodeImages(supabase: Supa, assets: Record<string, string>): Promise<Record<string, string>> {
  const images = Object.entries(assets).filter(([rel]) => rel.startsWith("images/"));
  if (!images.length) return {};
  const { data } = await supabase.storage.from("studio").createSignedUrls(images.map(([, key]) => key), HOURS);
  return Object.fromEntries(images.flatMap(([rel], i) => (data?.[i]?.signedUrl ? [[rel, data[i].signedUrl!]] : [])));
}
