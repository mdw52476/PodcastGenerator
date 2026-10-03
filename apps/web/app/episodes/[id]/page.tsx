import { notFound } from "next/navigation";
import type { ResolvedPlan } from "@shoebox/edit-plan";
import { DecisionBadge } from "@/components/badges";
import { DecisionPanel, StatusSelect } from "@/components/EpisodeControls";
import { Header } from "@/components/Header";
import { PreviewPlayer } from "@/components/PreviewPlayer";
import { RenderPanel } from "@/components/RenderPanel";
import { supabaseServer } from "@/lib/supabase/server";
import { showLabel, stageLabel, timeAgo, type EpisodeRow, type EventRow, type JobRow } from "@/lib/stages";

export const dynamic = "force-dynamic";

type Supa = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * Load the preview bundle (props.json written by the worker) and swap its
 * relative asset paths for short-lived signed URLs the player can fetch.
 */
async function loadPreview(supabase: Supa, episodeId: string) {
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

const EVENT_TEXT: Record<EventRow["kind"], string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  status: "Moved",
  note: "Note",
};

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeId = decodeURIComponent(id);
  const supabase = await supabaseServer();
  const [{ data: ep }, { data: events }, { data: jobs }, preview] = await Promise.all([
    supabase.from("episodes").select("id, show, title, status, updated_at").eq("id", episodeId).maybeSingle(),
    supabase.from("episode_events").select("*").eq("episode_id", episodeId).order("created_at", { ascending: false }),
    supabase
      .from("render_jobs")
      .select("id, episode_id, kind, status, stage, progress, outputs, error, created_at, finished_at")
      .eq("episode_id", episodeId)
      .order("created_at", { ascending: false })
      .limit(8),
    loadPreview(supabase, episodeId),
  ]);
  if (!ep) notFound();
  const episode = ep as EpisodeRow;
  const history = (events ?? []) as EventRow[];
  const lastDecision = history.find((e) => e.kind === "approved" || e.kind === "changes_requested");

  return (
    <>
      <Header crumb={episode.title} />
      <main className="mx-auto grid max-w-[1500px] gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-sm text-muted">
                {showLabel(episode.show)} · {episode.id}
              </div>
              <h1 className="font-display text-3xl font-medium tracking-wide">{episode.title}</h1>
            </div>
            <div className="flex items-center gap-3">
              <DecisionBadge event={lastDecision} />
              <StatusSelect episodeId={episode.id} status={episode.status} />
            </div>
          </div>

          <div className="mt-4">
            {preview ? (
              <PreviewPlayer plan={preview.plan} labels={preview.placeholderLabels} />
            ) : (
              <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-line bg-panel p-6 text-center text-sm text-muted">
                No preview yet. Use “Refresh preview” on the right; it takes about a minute.
              </div>
            )}
            <p className="mt-2 text-xs text-muted">
              Preview plays the same composition the worker renders. Grain and fine detail look best in the downloaded 1080p file.
            </p>
          </div>

          <section className="mt-6">
            <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">History</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {history.map((e) => (
                <li key={e.id} className="rounded-md border border-line bg-panel px-3 py-2.5 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={e.kind === "approved" ? "text-ok" : e.kind === "changes_requested" ? "text-amber" : ""}>
                      {EVENT_TEXT[e.kind]}
                      {e.kind === "status" && e.to_status ? ` to ${stageLabel(e.to_status)}` : ""}
                    </span>
                    <span className="text-xs text-muted">{timeAgo(e.created_at)}</span>
                  </div>
                  {e.body && <p className="mt-1 whitespace-pre-wrap text-muted">{e.body}</p>}
                </li>
              ))}
              {history.length === 0 && <li className="text-sm text-muted">Nothing yet.</li>}
            </ul>
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <DecisionPanel episodeId={episode.id} />
          <RenderPanel episodeId={episode.id} initialJobs={(jobs ?? []) as JobRow[]} />
        </aside>
      </main>
    </>
  );
}
