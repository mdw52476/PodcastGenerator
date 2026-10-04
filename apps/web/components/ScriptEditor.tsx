"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { paragraphsToVoice, scriptIssues, splitParagraphs, voicedParagraphs, type WordTiming } from "@shoebox/edit-plan";
import { queueRevoice, saveScript } from "@/app/episodes/[id]/script/actions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo, type JobRow } from "@/lib/stages";

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/**
 * The episode script with live text-rule checks. Paragraphs that differ from
 * the voiced narration are marked; re-voicing generates only those.
 */
export function ScriptEditor({ episodeId, voiced, words, initial, jobs: initialJobs }: { episodeId: string; voiced: string; words: WordTiming[]; initial: string; jobs: JobRow[] }) {
  const router = useRouter();
  const [script, setScript] = useState(initial);
  const [savedScript, setSavedScript] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [jobs, setJobs] = useState(initialJobs);
  const [confirming, setConfirming] = useState(false);

  const issues = useMemo(() => scriptIssues(script), [script]);
  const plan = useMemo(() => paragraphsToVoice(words, script), [words, script]);
  const oldParas = useMemo(() => voicedParagraphs(words), [words]);
  const removed = plan.ops.filter((o) => o.kind === "delete").map((o) => (o.kind === "delete" ? o.oldIndex : -1));
  const status = (k: number) => {
    const op = plan.ops.find((o) => (o.kind === "keep" || o.kind === "replace" || o.kind === "insert") && o.newIndex === k);
    return op?.kind ?? "keep";
  };
  const changed = plan.ops.some((o) => o.kind !== "keep");
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => setJobs(initialJobs), [initialJobs]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const { data } = await supabaseBrowser()
        .from("render_jobs")
        .select("id, episode_id, kind, status, stage, progress, outputs, options, error, created_at, finished_at")
        .eq("episode_id", episodeId)
        .in("kind", ["voice", "revoice"])
        .order("created_at", { ascending: false })
        .limit(5);
      if (!data) return;
      const done = (data as JobRow[]).some((j) => j.status !== "queued" && j.status !== "running" && jobs.find((o) => o.id === j.id && (o.status === "queued" || o.status === "running")));
      setJobs(data as JobRow[]);
      if (done) router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [active, episodeId, jobs, router]);

  useEffect(() => {
    if (script === savedScript) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [script, savedScript]);

  const run = (fn: () => Promise<string>) =>
    start(async () => {
      setMessage(null);
      try {
        setMessage({ tone: "ok", text: await fn() });
        setSavedScript(script);
        router.refresh();
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
      }
    });

  const paras = splitParagraphs(script);
  const badge = (k: number) => {
    const s = status(k);
    if (s === "replace") return <span className="rounded bg-amber/15 px-1.5 text-[11px] text-amber">changed</span>;
    if (s === "insert") return <span className="rounded bg-teal/20 px-1.5 text-[11px] text-teal">new</span>;
    return null;
  };

  return (
    <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Script</h2>
          <span className="text-xs text-muted">Blank lines separate paragraphs. Each paragraph is voiced as one piece.</span>
        </div>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck
          className="min-h-[60vh] w-full resize-y rounded-lg border border-line bg-panel p-4 font-sans text-[15px] leading-relaxed outline-none focus:border-amber"
          aria-label="Episode script"
        />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setScript(voiced)} disabled={script === voiced} className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-raised disabled:opacity-40">
            Reset to the voiced script
          </button>
        </div>
      </section>

      <aside className="flex flex-col gap-4">
        <section className="rounded-lg border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Changes</h2>
          {!changed ? (
            <p className="mt-2 text-sm text-muted">The script matches the narration.</p>
          ) : (
            <>
              <ul className="mt-2 space-y-1.5 text-sm">
                {paras.map((p, k) =>
                  status(k) !== "keep" ? (
                    <li key={k} className="flex gap-2">
                      <span className="shrink-0 text-xs text-muted">¶{k + 1}</span>
                      {badge(k)}
                      <span className="truncate text-muted">{p}</span>
                    </li>
                  ) : null,
                )}
                {removed.map((o) => (
                  <li key={`r${o}`} className="flex gap-2">
                    <span className="shrink-0 text-xs text-muted">at {fmt(oldParas[o].start)}</span>
                    <span className="rounded bg-danger/15 px-1.5 text-[11px] text-danger">removed</span>
                    <span className="truncate text-muted line-through">{oldParas[o].text}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm">
                Re-voicing generates <b>{plan.toVoice.length}</b> paragraph{plan.toVoice.length === 1 ? "" : "s"}: <b>{plan.characters.toLocaleString()}</b> ElevenLabs characters.
                {removed.length > 0 && ` ${removed.length} removed paragraph${removed.length === 1 ? "" : "s"} cost nothing.`}
              </p>
              <p className="mt-1 text-xs text-muted">Unchanged paragraphs keep their exact audio. Cuts, cards, music and shorts after an edit shift with it.</p>
            </>
          )}
        </section>

        <section className="rounded-lg border border-line bg-panel p-4">
          <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Text rules</h2>
          {issues.errors.length === 0 && issues.warnings.length === 0 ? (
            <p className="mt-2 text-sm text-ok">All paragraphs pass.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-xs">
              {issues.errors.map((e, i) => (
                <li key={`e${i}`} className="text-danger">
                  {e}
                </li>
              ))}
              {issues.warnings.map((w, i) => (
                <li key={`w${i}`} className="text-amber">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4">
          <button
            onClick={() => run(async () => (await saveScript(episodeId, script), "Script saved (not voiced)."))}
            disabled={pending || script === savedScript}
            className="rounded-md bg-raised px-3 py-2 text-sm font-medium hover:brightness-125 disabled:opacity-40"
          >
            {script === savedScript ? "Script saved" : "Save script"}
          </button>
          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              disabled={pending || !changed || issues.errors.length > 0 || active}
              className="rounded-md bg-amber px-3 py-2 text-sm font-medium text-ink hover:brightness-110 disabled:opacity-40"
            >
              Re-voice changes…
            </button>
          ) : (
            <div className="rounded-md border border-amber/50 bg-amber/10 p-3 text-sm">
              <p>
                Spend <b>{plan.characters.toLocaleString()}</b> ElevenLabs characters to re-voice {plan.toVoice.length} paragraph{plan.toVoice.length === 1 ? "" : "s"}? This takes a minute or two on Railway.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => {
                    setConfirming(false);
                    run(async () => {
                      const r = await queueRevoice(episodeId, script);
                      return `Re-voicing ${r.paragraphs} paragraph(s), ${r.characters} characters. Progress below.`;
                    });
                  }}
                  className="rounded-md bg-amber px-3 py-1.5 font-medium text-ink"
                >
                  Yes, re-voice
                </button>
                <button onClick={() => setConfirming(false)} className="rounded-md px-3 py-1.5 text-muted hover:bg-raised">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {active && <p className="text-xs text-teal">A voice job is running for this episode.</p>}
          {message && <p className={`text-sm ${message.tone === "ok" ? "text-ok" : "text-danger"}`}>{message.text}</p>}
        </section>

        {jobs.length > 0 && (
          <section className="rounded-lg border border-line bg-panel p-4">
            <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Voice jobs</h2>
            <ul className="mt-2 divide-y divide-line text-sm">
              {jobs.map((j) => {
                const o = (j.outputs ?? {}) as { characters?: number; voicedParagraphs?: number[]; notes?: string[]; durationSec?: number };
                return (
                  <li key={j.id} className="py-2">
                    <div className="flex justify-between gap-2">
                      <span className={j.status === "failed" ? "text-danger" : j.status === "succeeded" ? "text-ok" : "text-teal"}>
                        {j.kind === "voice" ? "Voice" : "Re-voice"}: {j.status === "running" ? `${Math.round(j.progress * 100)}%, ${j.stage}` : j.status}
                      </span>
                      <span className="text-xs text-muted">{timeAgo(j.created_at)}</span>
                    </div>
                    {j.status === "succeeded" && (
                      <p className="mt-0.5 text-xs text-muted">
                        {o.characters} characters, paragraphs {o.voicedParagraphs?.join(", ")}; narration now {o.durationSec ? fmt(o.durationSec) : "?"}. Preview updated.
                      </p>
                    )}
                    {o.notes?.length ? (
                      <ul className="mt-1 list-disc pl-4 text-xs text-amber/90">
                        {o.notes.map((n, i) => (
                          <li key={i}>{n}</li>
                        ))}
                      </ul>
                    ) : null}
                    {j.status === "failed" && <p className="mt-0.5 text-xs break-words text-danger">{j.error}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
