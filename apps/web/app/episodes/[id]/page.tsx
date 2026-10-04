import { notFound } from "next/navigation";
import { DecisionBadge } from "@/components/badges";
import { DecisionPanel, StatusSelect } from "@/components/EpisodeControls";
import { Header } from "@/components/Header";
import { PreviewPlayer } from "@/components/PreviewPlayer";
import { RenderPanel } from "@/components/RenderPanel";
import Link from "next/link";
import { loadPreview } from "@/lib/preview";
import { supabaseServer } from "@/lib/supabase/server";
import { showLabel, stageLabel, timeAgo, type EpisodeRow, type EventRow, type JobRow } from "@/lib/stages";

export const dynamic = "force-dynamic";

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
      .select("id, episode_id, kind, status, stage, progress, outputs, options, error, created_at, finished_at")
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
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted">
                Preview plays the same composition the worker renders. Grain and fine detail look best in the downloaded 1080p file.
              </p>
              <div className="flex gap-2">
                <Link href={`/episodes/${encodeURIComponent(episode.id)}/edit`} className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-amber/60">
                  Edit timeline
                </Link>
                <Link href={`/episodes/${encodeURIComponent(episode.id)}/clips`} className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-amber/60">
                  Clipping studio
                </Link>
              </div>
            </div>
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
