import Link from "next/link";
import { Header } from "@/components/Header";
import { DecisionBadge, JobStatus } from "@/components/badges";
import { IdeaButtons } from "@/components/IdeaButtons";
import { supabaseServer } from "@/lib/supabase/server";
import { STAGES, showLabel, timeAgo, type EpisodeRow, type EventRow, type JobRow } from "@/lib/stages";

export const dynamic = "force-dynamic";

export default async function Board() {
  const supabase = await supabaseServer();
  const [{ data: episodes }, { data: events }, { data: jobs }, { data: owner }] = await Promise.all([
    supabase.from("episodes").select("id, show, title, status, updated_at, autopilot, pitch").neq("status", "passed").order("updated_at", { ascending: false }),
    supabase.from("episode_events").select("*").in("kind", ["approved", "changes_requested"]).order("created_at", { ascending: false }),
    supabase.from("render_jobs").select("id, episode_id, kind, status, progress, created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("app_owners").select("user_id").maybeSingle(),
  ]);

  const latestDecision = new Map<string, EventRow>();
  for (const e of (events ?? []) as EventRow[]) if (!latestDecision.has(e.episode_id)) latestDecision.set(e.episode_id, e);
  const latestJob = new Map<string, JobRow>();
  for (const j of (jobs ?? []) as JobRow[]) if (!latestJob.has(j.episode_id)) latestJob.set(j.episode_id, j);
  const eps = (episodes ?? []) as EpisodeRow[];

  return (
    <>
      <Header />
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        {!owner && (
          <p className="mb-6 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
            This account is signed in but is not set up as the studio owner, so nothing is visible.
          </p>
        )}
        <div className="flex gap-3 overflow-x-auto pb-4 max-md:flex-col">
          {STAGES.map((stage) => {
            const cards = eps.filter((e) => e.status === stage.id);
            return (
              <section key={stage.id} className="flex w-60 shrink-0 flex-col rounded-lg bg-panel max-md:w-full">
                <h2 className="flex items-center justify-between px-3 pt-3 pb-2 text-xs font-semibold tracking-wider text-muted uppercase">
                  {stage.label}
                  <span className="font-normal">{cards.length || ""}</span>
                </h2>
                <div className="flex min-h-12 flex-col gap-2 px-2 pb-2">
                  {cards.map((e) => {
                    const job = latestJob.get(e.id);
                    // Autopilot pitches: read the logline and decide right on the board.
                    if (e.status === "idea" && e.pitch)
                      return (
                        <div key={e.id} className="rounded-md border border-teal/40 bg-raised p-3">
                          <div className="text-xs text-muted">{showLabel(e.show)} · autopilot pitch</div>
                          <Link href={`/episodes/${encodeURIComponent(e.id)}`} className="mt-0.5 block leading-snug font-medium hover:text-amber">
                            {e.title}
                          </Link>
                          <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-muted">{e.pitch.logline}</p>
                          <div className="mt-2">
                            <IdeaButtons episodeId={e.id} compact />
                          </div>
                        </div>
                      );
                    return (
                      <Link
                        key={e.id}
                        href={`/episodes/${encodeURIComponent(e.id)}`}
                        className="rounded-md border border-line bg-raised p-3 transition-colors hover:border-amber/60"
                      >
                        <div className="text-xs text-muted">{showLabel(e.show)}</div>
                        <div className="mt-0.5 leading-snug font-medium">{e.title}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <DecisionBadge event={latestDecision.get(e.id)} />
                          {job && <JobStatus job={job} />}
                        </div>
                        <div className="mt-2 text-xs text-muted">{timeAgo(e.updated_at)}</div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        {eps.length === 0 && owner && (
          <p className="mt-4 text-sm text-muted">
            No episodes yet. Episodes appear here once the pipeline (or <code>pnpm job submit</code>) saves one.
          </p>
        )}
      </main>
    </>
  );
}
