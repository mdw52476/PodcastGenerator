import Link from "next/link";
import { Header } from "@/components/Header";
import { supabaseServer } from "@/lib/supabase/server";
import { createShow } from "./actions";

export const dynamic = "force-dynamic";

export default async function ShowsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await supabaseServer();
  const [{ data: shows }, { data: eps }] = await Promise.all([
    supabase.from("shows").select("id, name, profile, updated_at").order("name"),
    supabase.from("episodes").select("show"),
  ]);
  const count = (id: string) => (eps ?? []).filter((e) => e.show === id).length;
  const field = "rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-amber";

  return (
    <>
      <Header crumb="Shows" />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="font-display text-3xl tracking-wide">Shows</h1>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {(shows ?? []).map((s) => (
            <li key={s.id} className="rounded-lg border border-line bg-panel p-4">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/shows/${s.id}`} className="text-lg font-medium hover:text-amber">
                  {s.name}
                </Link>
                <span className="text-xs text-muted">{count(s.id)} episode(s)</span>
              </div>
              <p className="mt-1 text-sm text-muted">
                Narrator {s.profile.narrator?.name} · voice {s.profile.voice?.voiceName?.split(" - ")[0] || s.profile.voice?.voiceId}
              </p>
              <div className="mt-3 flex gap-3 text-sm">
                <Link href={`/shows/${s.id}`} className="text-amber hover:underline">
                  Settings
                </Link>
                <Link href={`/shows/${s.id}/new-episode`} className="text-amber hover:underline">
                  New episode from a script
                </Link>
              </div>
            </li>
          ))}
        </ul>

        <section className="mt-8 rounded-lg border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Add a show</h2>
          <p className="mt-1 text-sm text-muted">It starts as a copy of another show&apos;s settings; change anything on the next page.</p>
          <form action={createShow} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Name
              <input name="name" required className={field} placeholder="e.g. The Night Ledger" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Short id
              <input name="id" required pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" className={field} placeholder="the-night-ledger" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Copy settings from
              <select name="from" className={field}>
                {(shows ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="rounded-md bg-amber px-4 py-2 text-sm font-medium text-ink hover:brightness-110">Add show</button>
          </form>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </section>
      </main>
    </>
  );
}
