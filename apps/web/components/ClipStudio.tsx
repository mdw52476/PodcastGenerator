"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Player } from "@remotion/player";
import { Short as ShortComposition } from "@shoebox/engine/short";
import {
  autoHook,
  CueIndex,
  PLATFORMS,
  resolveShort,
  scoreWindow,
  suggestClips,
  type ClipScore,
  type Platform,
  type ResolvedPlan,
  type Short,
  type WordTiming,
} from "@shoebox/edit-plan";
import { checkText, type Violation } from "@shoebox/text-rules";
import { queueShorts, saveShorts } from "@/app/episodes/[id]/clips/actions";
import { downloadKey } from "@/lib/download";
import { supabaseBrowser } from "@/lib/supabase/client";
import { timeAgo, type JobRow } from "@/lib/stages";

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const len = (s: number, e: number) => `${Math.round(e - s)} s`;
const input = "w-full rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-amber";
const label = "mb-1 block text-xs font-semibold tracking-wider text-muted uppercase";

function ScoreBadge({ score }: { score: ClipScore | null }) {
  if (!score) return null;
  const tone = score.total >= 0.85 ? "bg-ok/15 text-ok" : score.total >= 0.7 ? "bg-amber/15 text-amber" : "bg-danger/15 text-danger";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tone}`}>{Math.round(score.total * 100)}</span>;
}

function RuleNotes({ text }: { text: string | null | undefined }) {
  const v: Violation[] = text ? checkText(text) : [];
  if (!v.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {v.map((x, i) => (
        <li key={i} className={x.severity === "error" ? "text-danger" : "text-amber"}>
          {x.message}
        </li>
      ))}
    </ul>
  );
}

const hasRuleErrors = (s: Short) => [s.hook, s.title, s.description].some((t) => t && checkText(t).some((v) => v.severity === "error"));

/** Script words around a boundary; click one to move the in- or out-point there. */
function WordStrip({ words, around, edge, inClip, onPick }: { words: WordTiming[]; around: number; edge: "start" | "end"; inClip: (i: number) => boolean; onPick: (t: number) => void }) {
  const idx = edge === "start" ? words.findIndex((w) => w.start >= around - 0.02) : words.findLastIndex((w) => w.end <= around + 0.02);
  const from = Math.max(0, idx - 12);
  const to = Math.min(words.length, idx + 13);
  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-line bg-ink p-2 text-sm leading-relaxed">
      {words.slice(from, to).map((w, k) => {
        const i = from + k;
        const isEdge = i === idx;
        return (
          <button
            key={i}
            onClick={() => onPick(edge === "start" ? w.start : w.end)}
            title={`${edge === "start" ? "Start at" : "End after"} “${w.word}” (${fmt(edge === "start" ? w.start : w.end)})`}
            className={`rounded px-1 ${isEdge ? "bg-amber text-ink" : inClip(i) ? "text-text hover:bg-raised" : "text-muted/60 hover:bg-raised hover:text-text"}`}
          >
            {w.word}
          </button>
        );
      })}
    </div>
  );
}

export function ClipStudio({
  episodeId,
  preview,
  labels,
  shorts,
  initialJobs,
}: {
  episodeId: string;
  preview: ResolvedPlan;
  labels: boolean;
  shorts: Short[];
  initialJobs: JobRow[];
}) {
  const router = useRouter();
  const words = preview.words;
  const cues = useMemo(() => new CueIndex(words), [words]);
  const [drafts, setDrafts] = useState<Short[]>(shorts);
  const [selected, setSelected] = useState<string | null>(shorts[0]?.id ?? null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);

  /** Start/end on the episode timeline: explicit overrides first, else the cue phrases. */
  const timesOf = (s: Short) => {
    const a = s.startSec ?? cues.find(s.cueStart)?.start ?? 0;
    const b = s.endSec ?? cues.find(s.cueEnd, a)?.end ?? a + 30;
    return { start: a, end: b };
  };

  const editedPlan: ResolvedPlan = useMemo(
    () => ({
      ...preview,
      shorts: drafts.map((d) => {
        const { startSec: _a, endSec: _b, ...rest } = d;
        const t = timesOf(d);
        return { ...rest, hook: d.hook === undefined ? autoHook(words, t.start, t.end) : d.hook, hookAuto: d.hook === undefined, ...t };
      }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, preview],
  );
  const current = drafts.find((d) => d.id === selected) ?? null;
  const props = useMemo(() => (current ? resolveShort(editedPlan, current.id, { placeholderLabels: labels }) : null), [editedPlan, current, labels]);
  const suggestions = useMemo(() => suggestClips(words, 8), [words]);

  const update = (patch: Partial<Short>) => {
    if (!current) return;
    setDrafts((ds) => ds.map((d) => (d.id === current.id ? { ...d, ...patch } : d)));
    setDirty(true);
  };

  const addFromSuggestion = (c: (typeof suggestions)[number]) => {
    let n = drafts.length + 1;
    while (drafts.some((d) => d.id === `short${n}`)) n++;
    const id = `short${n}`;
    const phrase = (a: number, b: number) => words.slice(a, b + 1).map((w) => w.word).join(" ");
    const s: Short = {
      id,
      cueStart: phrase(c.firstWord, Math.min(c.firstWord + 3, c.lastWord)),
      cueEnd: phrase(Math.max(c.firstWord, c.lastWord - 3), c.lastWord),
      startSec: c.start,
      endSec: c.end,
    };
    setDrafts((ds) => [...ds, s]);
    setSelected(id);
    setDirty(true);
  };

  const remove = (id: string) => {
    setDrafts((ds) => ds.filter((d) => d.id !== id));
    setChecked((c) => {
      const n = new Set(c);
      n.delete(id);
      return n;
    });
    if (selected === id) setSelected(drafts.find((d) => d.id !== id)?.id ?? null);
    setDirty(true);
  };

  const anyRuleErrors = drafts.some(hasRuleErrors);
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  const save = () => run(async () => {
    await saveShorts(episodeId, drafts);
    setDirty(false);
  });
  const render = (ids: string[]) => run(async () => {
    if (dirty) {
      await saveShorts(episodeId, drafts);
      setDirty(false);
    }
    await queueShorts(episodeId, ids);
    setChecked(new Set());
  });

  // Live job progress while anything is queued or running.
  useEffect(() => setJobs(initialJobs), [initialJobs]);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const { data } = await supabaseBrowser()
        .from("render_jobs")
        .select("id, episode_id, kind, status, stage, progress, outputs, options, error, created_at, finished_at")
        .eq("episode_id", episodeId)
        .eq("kind", "short")
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setJobs(data as JobRow[]);
    }, 4000);
    return () => clearInterval(t);
  }, [active, episodeId]);
  const latestJob = (id: string) => jobs.find((j) => j.options?.shortId === id);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const t = current ? timesOf(current) : null;
  const platform = current ? PLATFORMS[current.platform ?? preview.shortsDefaults.platform] : null;
  const clipLen = t ? t.end - t.start : 0;
  const shotsInClip = t ? preview.shots.filter((s) => s.end > t.start && s.start < t.end) : [];

  return (
    <div className="mt-4">
      {/* Action bar */}
      <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur">
        <button
          onClick={save}
          disabled={pending || !dirty || anyRuleErrors}
          className="rounded-md bg-raised px-3.5 py-2 text-sm font-medium hover:brightness-125 disabled:opacity-40"
        >
          {dirty ? "Save changes" : "Saved"}
        </button>
        <button
          onClick={() => render([...checked])}
          disabled={pending || checked.size === 0 || anyRuleErrors}
          className="rounded-md bg-amber px-3.5 py-2 text-sm font-medium text-ink hover:brightness-110 disabled:opacity-40"
        >
          Render selected ({checked.size})
        </button>
        {current && (
          <button onClick={() => render([current.id])} disabled={pending || anyRuleErrors} className="rounded-md border border-line px-3.5 py-2 text-sm hover:border-amber/60 disabled:opacity-40">
            Render {current.id}
          </button>
        )}
        {anyRuleErrors && <span className="text-sm text-danger">Fix the text-rule problems before saving.</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
        <span className="ml-auto text-xs text-muted">Each short renders on Railway in a few minutes and is copied to Dropbox.</span>
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-[300px_minmax(0,420px)_minmax(0,1fr)]">
        {/* Left: shorts + suggestions */}
        <div className="flex flex-col gap-6">
          <section>
            <h2 className={label}>Shorts</h2>
            <ul className="flex flex-col gap-2">
              {drafts.map((d) => {
                const dt = timesOf(d);
                const job = latestJob(d.id);
                return (
                  <li
                    key={d.id}
                    className={`flex items-start gap-2 rounded-md border p-2.5 ${selected === d.id ? "border-amber/70 bg-raised" : "border-line bg-panel"}`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${d.id} for batch render`}
                      checked={checked.has(d.id)}
                      onChange={(e) =>
                        setChecked((c) => {
                          const n = new Set(c);
                          if (e.target.checked) n.add(d.id);
                          else n.delete(d.id);
                          return n;
                        })
                      }
                      className="mt-1 accent-amber"
                    />
                    <button onClick={() => setSelected(d.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.id}</span>
                        <ScoreBadge score={scoreWindow(words, dt.start, dt.end)} />
                        <span className="text-xs text-muted">
                          {fmt(dt.start)} · {len(dt.start, dt.end)}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">{(d.hook === undefined ? autoHook(words, dt.start, dt.end) : d.hook) || d.cueStart}</div>
                      {job && (
                        <div className={`mt-1 text-xs ${job.status === "failed" ? "text-danger" : job.status === "succeeded" ? "text-ok" : "text-teal"}`}>
                          {job.status === "running" ? `rendering ${Math.round(job.progress * 100)}%` : job.status === "succeeded" ? `rendered ${timeAgo(job.finished_at ?? job.created_at)}` : job.status}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
              {drafts.length === 0 && <li className="text-sm text-muted">No shorts yet. Add one from the suggestions below.</li>}
            </ul>
          </section>

          <section>
            <h2 className={label}>Suggestions</h2>
            <p className="mb-2 text-xs text-muted">Scored on standing alone, hooking in the first seconds, and ending on a beat.</p>
            <ul className="flex flex-col gap-2">
              {suggestions.map((c, i) => {
                const taken = drafts.some((d) => {
                  const dt = timesOf(d);
                  return Math.min(dt.end, c.end) - Math.max(dt.start, c.start) > 0.5 * (c.end - c.start);
                });
                return (
                  <li key={i} className="rounded-md border border-line bg-panel p-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <ScoreBadge score={c.score} />
                      <span className="text-xs text-muted">
                        {fmt(c.start)} · {len(c.start, c.end)}
                      </span>
                      <button
                        onClick={() => addFromSuggestion(c)}
                        disabled={taken}
                        className="ml-auto rounded px-2 py-0.5 text-xs text-amber hover:bg-raised disabled:text-muted disabled:hover:bg-transparent"
                      >
                        {taken ? "Already a short" : "Add"}
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{c.text}</p>
                    {c.score.notes.length > 0 && <p className="mt-1 text-xs text-amber/80">{c.score.notes.join("; ")}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* Middle: vertical preview */}
        <div>
          {props ? (
            <div className="sticky top-32">
              <div className="mx-auto overflow-hidden rounded-lg border border-line bg-black" style={{ maxWidth: "min(420px, calc((100dvh - 200px) * 9 / 16))" }}>
                <Player
                  component={ShortComposition}
                  inputProps={props}
                  durationInFrames={Math.ceil(props.durationSec * preview.fps)}
                  fps={preview.fps}
                  compositionWidth={props.preset.width}
                  compositionHeight={props.preset.height}
                  style={{ width: "100%", aspectRatio: "9 / 16" }}
                  controls
                  clickToPlay
                  spaceKeyToPlayOrPause
                  showVolumeControls
                  acknowledgeRemotionLicense
                />
              </div>
              <p className="mt-2 text-center text-xs text-muted">Live preview. Edits show here right away; save to keep them.</p>
            </div>
          ) : (
            <div className="flex aspect-[9/16] items-center justify-center rounded-lg border border-dashed border-line text-sm text-muted">Pick or add a short</div>
          )}
        </div>

        {/* Right: editor */}
        {current && t && platform ? (
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl tracking-wide">{current.id}</h2>
              <button onClick={() => remove(current.id)} className="rounded px-2 py-1 text-xs text-danger hover:bg-danger/10">
                Delete short
              </button>
            </div>

            <section>
              <span className={label}>Trim</span>
              <p className="mb-2 text-sm">
                {fmt(t.start)} to {fmt(t.end)} ·{" "}
                <span className={clipLen < platform.minSec || clipLen > platform.maxSec ? "text-danger" : "text-ok"}>{clipLen.toFixed(1)} s</span>
                <span className="text-muted">
                  {" "}
                  ({platform.label}: {platform.minSec}–{platform.maxSec} s)
                </span>
              </p>
              <div className="flex flex-col gap-2">
                <div className="text-xs text-muted">Start: click the first word</div>
                <WordStrip words={words} around={t.start} edge="start" inClip={(i) => words[i].start >= t.start - 0.02 && words[i].end <= t.end + 0.02} onPick={(v) => update({ startSec: v })} />
                <div className="text-xs text-muted">End: click the last word</div>
                <WordStrip words={words} around={t.end} edge="end" inClip={(i) => words[i].start >= t.start - 0.02 && words[i].end <= t.end + 0.02} onPick={(v) => update({ endSec: v })} />
              </div>
            </section>

            <section>
              <div className="flex items-baseline justify-between gap-2">
                <label className={label} htmlFor="hook">
                  Hook (first 3 seconds)
                </label>
                <span className="text-xs text-muted">
                  {current.hook === undefined ? (
                    "automatic, picked from the clip"
                  ) : (
                    <button onClick={() => update({ hook: undefined })} className="text-amber hover:underline">
                      Use automatic
                    </button>
                  )}
                </span>
              </div>
              <input
                id="hook"
                value={current.hook === undefined ? (autoHook(words, t.start, t.end) ?? "") : (current.hook ?? "")}
                onChange={(e) => update({ hook: e.target.value || null })}
                className={`${input} ${current.hook === undefined ? "text-muted" : ""}`}
                placeholder="No hook. Type one, or use automatic."
              />
              <RuleNotes text={current.hook} />
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="platform">
                  Platform
                </label>
                <select id="platform" value={current.platform ?? preview.shortsDefaults.platform} onChange={(e) => update({ platform: e.target.value as Platform })} className={input}>
                  {Object.values(PLATFORMS).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section>
              <span className={label}>Vertical crop per shot</span>
              <div className="flex flex-col gap-3">
                {shotsInClip.map((s) => {
                  const x = current.crops?.[s.id]?.x ?? 0.5;
                  return (
                    <div key={s.id}>
                      <div className="flex justify-between text-xs text-muted">
                        <span className="truncate">
                          <b className="text-text">{s.id}</b> {s.prompt}
                        </span>
                        <span className="shrink-0 pl-2">{x < 0.45 ? "left" : x > 0.55 ? "right" : "centre"}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={x}
                        onChange={(e) => update({ crops: { ...(current.crops ?? {}), [s.id]: { x: Number(e.target.value) } } })}
                        className="w-full accent-amber"
                        aria-label={`Crop position for ${s.id}`}
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div>
                <label className={label} htmlFor="title">
                  Title
                </label>
                <input id="title" value={current.title ?? ""} onChange={(e) => update({ title: e.target.value || undefined })} className={input} />
                <RuleNotes text={current.title} />
              </div>
              <div>
                <label className={label} htmlFor="desc">
                  Description
                </label>
                <textarea id="desc" rows={3} value={current.description ?? ""} onChange={(e) => update({ description: e.target.value || undefined })} className={`${input} resize-y`} />
                <RuleNotes text={current.description} />
              </div>
              <div>
                <label className={label} htmlFor="tags">
                  Hashtags
                </label>
                <input
                  id="tags"
                  value={(current.hashtags ?? []).join(" ")}
                  onChange={(e) => {
                    const tags = e.target.value.split(/[\s,]+/).filter(Boolean).map((x) => (x.startsWith("#") ? x : `#${x}`));
                    update({ hashtags: tags.length ? tags : undefined });
                  }}
                  className={input}
                  placeholder="#truecrime #coldcase"
                />
              </div>
            </section>

            <section>
              <span className={label}>Renders of {current.id}</span>
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line bg-panel px-3">
                {jobs
                  .filter((j) => j.options?.shortId === current.id)
                  .slice(0, 5)
                  .map((j) => (
                    <li key={j.id} className="py-2 text-sm">
                      <div className="flex justify-between gap-2">
                        <span className={j.status === "failed" ? "text-danger" : j.status === "succeeded" ? "text-ok" : "text-teal"}>
                          {j.status === "running" ? `rendering ${Math.round(j.progress * 100)}%` : j.status}
                        </span>
                        <span className="text-xs text-muted">{timeAgo(j.created_at)}</span>
                      </div>
                      {j.status === "succeeded" && j.outputs?.master && (
                        <button onClick={() => downloadKey(j.outputs!.master!.key)} className="mt-0.5 text-xs text-amber hover:underline">
                          Download ({j.outputs.loudness?.integrated} LUFS{j.outputs.dropbox?.length ? ", in Dropbox" : ""})
                        </button>
                      )}
                      {j.status === "failed" && <p className="mt-0.5 text-xs break-words text-danger">{j.error}</p>}
                    </li>
                  ))}
                {!jobs.some((j) => j.options?.shortId === current.id) && <li className="py-2 text-sm text-muted">Not rendered yet.</li>}
              </ul>
            </section>
          </div>
        ) : (
          <div className="text-sm text-muted">Select a short to edit it.</div>
        )}
      </div>
    </div>
  );
}
