"use client";
import { useMemo, useState, useTransition } from "react";
import { scriptIssues, splitParagraphs } from "@shoebox/edit-plan";
import { createEpisode } from "@/app/shows/actions";

const field = "w-full rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-amber";
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

export function NewEpisodeForm({ showId }: { showId: string }) {
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [script, setScript] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const issues = useMemo(() => scriptIssues(script), [script]);
  const paras = splitParagraphs(script).length;
  const minutes = script.trim() ? script.trim().split(/\s+/).length / 140 : 0;
  const episodeId = idTouched ? id : slugify(`${showId.split("-").map((w) => w[0]).join("")}-${title}`);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Episode title (on screen)
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} placeholder="The Keeper's Log" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Episode id
          <input
            value={episodeId}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value.toLowerCase());
            }}
            className={field}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Script (blank lines between paragraphs)
        <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={16} className={`${field} resize-y text-[15px] leading-relaxed`} />
      </label>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
        <span>{paras} paragraph(s)</span>
        <span>
          <b className="text-text">{issues.characters.toLocaleString()}</b> ElevenLabs characters
        </span>
        <span>about {minutes < 1 ? `${Math.round(minutes * 60)} seconds` : `${minutes.toFixed(1)} minutes`} at 140 words a minute</span>
      </div>
      {(issues.errors.length > 0 || issues.warnings.length > 0) && (
        <ul className="space-y-1 rounded-md border border-line bg-panel p-3 text-xs">
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
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          disabled={!title.trim() || !script.trim() || issues.errors.length > 0 || pending}
          className="self-start rounded-md bg-amber px-4 py-2 text-sm font-medium text-ink hover:brightness-110 disabled:opacity-40"
        >
          Create and voice…
        </button>
      ) : (
        <div className="rounded-md border border-amber/50 bg-amber/10 p-3 text-sm">
          <p>
            Spend <b>{issues.characters.toLocaleString()}</b> ElevenLabs characters to voice this script and create <b>{episodeId}</b>?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() =>
                start(async () => {
                  setError(null);
                  try {
                    await createEpisode(showId, title, episodeId, script);
                  } catch (e) {
                    // redirect() throws a special error on success; let Next handle it.
                    if (e instanceof Error && e.message === "NEXT_REDIRECT") throw e;
                    setError(e instanceof Error ? e.message : String(e));
                    setConfirming(false);
                  }
                })
              }
              disabled={pending}
              className="rounded-md bg-amber px-3 py-1.5 font-medium text-ink disabled:opacity-50"
            >
              {pending ? "Creating…" : "Yes, create and voice"}
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-md px-3 py-1.5 text-muted hover:bg-raised">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
