import Link from "next/link";
import { notFound } from "next/navigation";
import { joinParagraphs, voicedParagraphs, type WordTiming } from "@shoebox/edit-plan";
import { Header } from "@/components/Header";
import { ScriptEditor } from "@/components/ScriptEditor";
import { supabaseServer } from "@/lib/supabase/server";
import type { JobRow } from "@/lib/stages";

export const dynamic = "force-dynamic";

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeId = decodeURIComponent(id);
  const supabase = await supabaseServer();
  const [{ data: ep }, { data: blob }, { data: jobs }] = await Promise.all([
    supabase.from("episodes").select("id, title, script").eq("id", episodeId).maybeSingle(),
    supabase.storage.from("studio").download(`previews/${episodeId}/props.json`),
    supabase
      .from("render_jobs")
      .select("id, episode_id, kind, status, stage, progress, outputs, options, error, created_at, finished_at")
      .eq("episode_id", episodeId)
      .in("kind", ["voice", "revoice"])
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  if (!ep) notFound();
  const words: WordTiming[] = blob ? JSON.parse(await blob.text()).plan.words ?? [] : [];
  const voiced = words.length ? joinParagraphs(voicedParagraphs(words).map((p) => p.text)) : "";

  return (
    <>
      <Header crumb={`${ep.title} · Script`} />
      <main className="mx-auto max-w-[1400px] px-4 py-4">
        <Link href={`/episodes/${encodeURIComponent(episodeId)}`} className="text-sm text-muted hover:text-text">
          ← Back to episode
        </Link>
        {!words.length ? (
          <p className="mt-6 rounded-md border border-line bg-panel px-4 py-3 text-sm text-muted">
            The voiced script isn&apos;t known yet. On the episode page, click “Refresh preview”, wait about two minutes, then come back.
          </p>
        ) : (
          <ScriptEditor episodeId={episodeId} voiced={voiced} words={words} initial={ep.script ?? voiced} jobs={(jobs ?? []) as JobRow[]} />
        )}
      </main>
    </>
  );
}
