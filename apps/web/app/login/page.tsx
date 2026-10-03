import { sendLink } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { sent, error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="font-display text-3xl font-semibold tracking-[0.12em] uppercase">Shoebox Studio</h1>
      <div className="mt-2 h-0.5 w-16 bg-amber" />
      {sent ? (
        <p className="mt-8 leading-relaxed text-muted">
          Check your email for a sign-in link from Supabase. Open it on this computer; it signs you in here.
        </p>
      ) : (
        <form action={sendLink} className="mt-8 flex flex-col gap-3">
          <label htmlFor="email" className="text-sm text-muted">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="rounded-md border border-line bg-panel px-3 py-2.5 text-text outline-none focus:border-amber"
          />
          <button className="mt-2 rounded-md bg-amber px-4 py-2.5 font-medium text-ink hover:brightness-110">Email me a sign-in link</button>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      )}
    </main>
  );
}
