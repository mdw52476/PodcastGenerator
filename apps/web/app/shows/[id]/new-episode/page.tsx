import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/components/Header";
import { NewEpisodeForm } from "@/components/NewEpisodeForm";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewEpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: show } = await supabase.from("shows").select("id, name, profile").eq("id", id).maybeSingle();
  if (!show) notFound();
  return (
    <>
      <Header crumb={`${show.name} · New episode`} />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Link href={`/shows/${id}`} className="text-sm text-muted hover:text-text">
          ← {show.name} settings
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-wide">New episode</h1>
        <p className="mt-1 text-sm text-muted">
          Paste a finished script. The worker voices it as {show.profile.narrator?.name} with the show&apos;s voice, then builds a starting edit plan in the show&apos;s style: a shot about
          every 8 to 15 seconds (placeholder pictures), titles, music, and suggested shorts. The episode lands on the board as Edited, ready to preview.
        </p>
        <NewEpisodeForm showId={id} />
      </main>
    </>
  );
}
