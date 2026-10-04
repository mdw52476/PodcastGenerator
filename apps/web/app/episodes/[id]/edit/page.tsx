import Link from "next/link";
import { notFound } from "next/navigation";
import { parsePlan } from "@shoebox/edit-plan";
import { Editor } from "@/components/editor/Editor";
import { Header } from "@/components/Header";
import { loadPreviewBundle, signEpisodeImages } from "@/lib/preview";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const episodeId = decodeURIComponent(id);
  const supabase = await supabaseServer();
  const [{ data: ep }, bundle] = await Promise.all([
    supabase.from("episodes").select("id, title, plan, assets").eq("id", episodeId).maybeSingle(),
    loadPreviewBundle(supabase, episodeId),
  ]);
  if (!ep) notFound();
  const parsed = parsePlan(ep.plan);
  const assets = (ep.assets ?? {}) as Record<string, string>;
  const imageUrls = await signEpisodeImages(supabase, assets);

  return (
    <>
      <Header crumb={`${ep.title} · Edit`} />
      <main className="mx-auto max-w-[1800px] px-4 py-4">
        <Link href={`/episodes/${encodeURIComponent(episodeId)}`} className="text-sm text-muted hover:text-text">
          ← Back to episode
        </Link>
        {!parsed.success ? (
          <p className="mt-4 text-sm text-danger">The stored plan could not be read: {parsed.error.issues[0]?.message}</p>
        ) : !bundle || !bundle.plan.words?.length ? (
          <p className="mt-6 rounded-md border border-line bg-panel px-4 py-3 text-sm text-muted">
            The preview bundle is missing. On the episode page, click “Refresh preview”, wait about two minutes, then come back.
          </p>
        ) : (
          <Editor
            episodeId={episodeId}
            initialPlan={parsed.data}
            words={bundle.plan.words}
            bundle={{ music: bundle.plan.music.map((m, i) => ({ url: bundle.urls.music[i], seconds: m.end + m.fadeOutSec - m.start })), narration: bundle.urls.narration }}
            imageUrls={imageUrls}
            placeholderLabels={bundle.placeholderLabels}
          />
        )}
      </main>
    </>
  );
}
