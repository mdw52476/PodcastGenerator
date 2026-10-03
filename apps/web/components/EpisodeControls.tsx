"use client";
import { useState, useTransition } from "react";
import { addNote, approve, requestChanges, setStatus } from "@/app/episodes/[id]/actions";
import { STAGES } from "@/lib/stages";

const btn = "rounded-md px-3.5 py-2 text-sm font-medium disabled:opacity-50";

export function StatusSelect({ episodeId, status }: { episodeId: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      Stage
      <select
        value={status}
        disabled={pending}
        onChange={(e) => start(() => setStatus(episodeId, e.target.value))}
        className="rounded-md border border-line bg-panel px-2 py-1.5 text-text"
      >
        {STAGES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function DecisionPanel({ episodeId }: { episodeId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
        setNote("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Decision</h2>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Note (required when requesting changes)"
        className="mt-3 w-full resize-y rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-amber"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button disabled={pending} onClick={() => run(() => approve(episodeId, note))} className={`${btn} bg-ok text-ink hover:brightness-110`}>
          Approve
        </button>
        <button
          disabled={pending || !note.trim()}
          onClick={() => run(() => requestChanges(episodeId, note))}
          className={`${btn} bg-amber text-ink hover:brightness-110`}
        >
          Request changes
        </button>
        <button disabled={pending || !note.trim()} onClick={() => run(() => addNote(episodeId, note))} className={`${btn} text-muted hover:bg-raised hover:text-text`}>
          Add note only
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <p className="mt-3 text-xs text-muted">Approving records your decision. Nothing is published from here.</p>
    </section>
  );
}
