import Link from "next/link";
import { notFound } from "next/navigation";
import { parsePlan } from "@shoebox/edit-plan";
import { ClipStudio } from "@/components/ClipStudio";
import { Header } from "@/components/Header";
import { loadPreview } from "@/lib/preview";
import { supabaseServer } from "@/lib/supabase/server";
import type { JobRow } from "@/lib/stages";

export const dynamic = "force-dynamic";

export default async function ClipsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeId = decodeURIComponent(id);
  const supabase = await supabaseServer();
  const [{ data: ep }, { data: jobs }, preview] = await Promise.all([
    supabase.from("episodes").select("id, title, plan").eq("id", episodeId).maybeSingle(),
    supabase
      .from("render_jobs")
      .select("id, episode_id, kind, status, stage, progress, outputs, options, error, created_at, finished_at")
      .eq("episode_id", episodeId)
      .eq("kind", "short")
      .order("created_at", { ascending: false })
      .limit(50),
    loadPreview(supabase, episodeId),
  ]);
  if (!ep) notFound();
  const parsed = parsePlan(ep.plan);

  return (
    <>
      <Header crumb={`${ep.title} · Clips`} />
      <main className="mx-auto max-w-[1500px] px-4 py-6">
        <Link href={`/episodes/${encodeURIComponent(episodeId)}`} className="text-sm text-muted hover:text-text">
          ← Back to episode
        </Link>
        {!parsed.success ? (
          <p className="mt-4 text-sm text-danger">The stored plan could not be read: {parsed.error.issues[0]?.message}</p>
        ) : !preview || !preview.plan.words?.length ? (
          <p className="mt-6 rounded-md border border-line bg-panel px-4 py-3 text-sm text-muted">
            The preview bundle is missing or from before the clipping studio existed. On the episode page, click “Refresh preview”, wait about two
            minutes, then come back.
          </p>
        ) : (
          <ClipStudio episodeId={episodeId} preview={preview.plan} labels={preview.placeholderLabels} shorts={parsed.data.shorts} initialJobs={(jobs ?? []) as JobRow[]} />
        )}
      </main>
    </>
  );
}
