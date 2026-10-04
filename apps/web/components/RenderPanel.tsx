"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { queueJob } from "@/app/episodes/[id]/actions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { JOB_KIND_LABEL, timeAgo, type JobRow } from "@/lib/stages";

const STAGE_LABEL: Record<string, string> = {
  starting: "starting",
  download: "fetching files",
  validate: "checking plan",
  align: "timing words",
  music: "making music",
  bundle: "preparing",
  render: "rendering frames",
  loudness: "leveling audio",
  proxy: "making review copy",
  upload: "uploading",
  done: "done",
};

function duration(sec?: number) {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  return m ? `${m} min ${Math.round(sec % 60)} s` : `${Math.round(sec)} s`;
}

async function download(key: string) {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const { data, error } = await supabaseBrowser().storage.from("studio").createSignedUrl(key, 3600, { download: name });
  if (error || !data) return alert(error?.message ?? "Could not create a download link.");
  window.location.href = data.signedUrl;
}

export function RenderPanel({ episodeId, initialJobs }: { episodeId: string; initialJobs: JobRow[] }) {
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  // Poll while something is queued or running; refresh the page (preview) when a job finishes.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      const { data } = await supabaseBrowser()
        .from("render_jobs")
        .select("id, episode_id, kind, status, stage, progress, outputs, options, error, created_at, finished_at")
        .eq("episode_id", episodeId)
        .order("created_at", { ascending: false })
        .limit(8);
      if (!data) return;
      const next = data as JobRow[];
      const finished = next.some((j) => j.status === "succeeded" && jobs.find((o) => o.id === j.id)?.status !== "succeeded");
      setJobs(next);
      if (finished) router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [active, episodeId, jobs, router]);

  useEffect(() => setJobs(initialJobs), [initialJobs]);

  const queue = (kind: "episode" | "preview" | "prepare") =>
    start(async () => {
      setError(null);
      try {
        await queueJob(episodeId, kind);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  const btn = "rounded-md border border-line px-3 py-2 text-sm hover:border-amber/60 disabled:opacity-50";
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Render</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={pending} onClick={() => queue("episode")} className={`${btn} bg-raised`}>
          Full episode
        </button>
        <button disabled={pending} onClick={() => queue("preview")} className={btn}>
          Quick test (10 s)
        </button>
        <button disabled={pending} onClick={() => queue("prepare")} className={btn}>
          Refresh preview
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-2 text-xs text-muted">A full episode takes about 30 minutes on Railway. You can close this page; it keeps going.</p>

      <ul className="mt-4 flex flex-col divide-y divide-line">
        {jobs.map((j) => (
          <li key={j.id} className="py-3">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">
                {JOB_KIND_LABEL[j.kind]}
                {j.options?.shortId ? `: ${j.options.shortId}` : ""}
              </span>
              <span className="text-xs text-muted">{timeAgo(j.created_at)}</span>
            </div>
            {(j.status === "running" || j.status === "queued") && (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded bg-ink">
                  <div className="h-full rounded bg-teal transition-[width] duration-700" style={{ width: `${Math.max(2, j.progress * 100)}%` }} />
                </div>
                <div className="mt-1 text-xs text-muted">
                  {j.status === "queued" ? "waiting for the worker" : `${Math.round(j.progress * 100)}%, ${STAGE_LABEL[j.stage ?? ""] ?? j.stage}`}
                </div>
              </div>
            )}
            {j.status === "failed" && <p className="mt-1 text-xs break-words text-danger">{j.error}</p>}
            {j.status === "succeeded" && j.kind !== "prepare" && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {j.outputs?.master && (
                  <button onClick={() => download(j.outputs!.master!.key)} className="text-amber hover:underline">
                    Download {j.kind === "episode" ? "1080p" : j.kind === "short" ? "short" : "clip"}
                  </button>
                )}
                {j.outputs?.proxy && (
                  <button onClick={() => download(j.outputs!.proxy!.key)} className="text-amber hover:underline">
                    720p review copy
                  </button>
                )}
                <span className="text-muted">
                  {duration(j.outputs?.renderSeconds)}
                  {j.outputs?.loudness?.integrated ? `, ${j.outputs.loudness.integrated} LUFS` : ""}
                  {j.outputs?.dropbox?.length ? ", copied to Dropbox" : ""}
                </span>
              </div>
            )}
            {j.status === "succeeded" && j.kind === "prepare" && <p className="mt-1 text-xs text-ok">Preview updated</p>}
          </li>
        ))}
        {jobs.length === 0 && <li className="py-3 text-sm text-muted">No renders yet.</li>}
      </ul>
    </section>
  );
}
