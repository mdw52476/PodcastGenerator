"use client";
import { useState, useTransition } from "react";
import { approveIdea, passIdea } from "@/app/episodes/[id]/actions";

/** Approve an autopilot idea for writing, or pass on it. */
export function IdeaButtons({ episodeId, compact = false }: { episodeId: string; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  const size = compact ? "px-2 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button disabled={pending} onClick={() => run(() => approveIdea(episodeId))} className={`rounded-md bg-ok font-medium text-ink hover:brightness-110 disabled:opacity-50 ${size}`}>
        Approve idea
      </button>
      <button disabled={pending} onClick={() => run(() => passIdea(episodeId))} className={`rounded-md text-muted hover:bg-raised hover:text-text disabled:opacity-50 ${size}`}>
        Pass
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
