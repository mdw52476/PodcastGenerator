import Link from "next/link";
import { notFound } from "next/navigation";
import { ShowProfile } from "@shoebox/edit-plan";
import { Header } from "@/components/Header";
import { ShowForm } from "@/components/ShowForm";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: show } = await supabase.from("shows").select("id, name, profile").eq("id", id).maybeSingle();
  if (!show) notFound();
  const profile = ShowProfile.parse(show.profile);
  return (
    <>
      <Header crumb={`${show.name} · Settings`} />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Link href="/shows" className="text-sm text-muted hover:text-text">
            ← All shows
          </Link>
          <Link href={`/shows/${id}/new-episode`} className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-amber/60">
            New episode from a script
          </Link>
        </div>
        <ShowForm id={id} initial={profile} />
      </main>
    </>
  );
}
