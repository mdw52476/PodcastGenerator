"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { normWord, type WordTiming } from "@shoebox/edit-plan";

interface Props {
  words: WordTiming[];
  overrides: Record<string, string>;
  focus: number | null;
  onFocus: (wordIndex: number) => void;
  setOverrides: (next: Record<string, string>) => void;
  currentTime: number;
}

/**
 * Every narration word as it appears in the captions. Click a word to fix how
 * it displays (times stay the same). Fixes are saved into the plan.
 */
export function CaptionsPanel({ words, overrides, focus, onFocus, setOverrides, currentTime }: Props) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [applyAll, setApplyAll] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const shown = (i: number) => overrides[i] ?? words[i].word;

  const paragraphs = useMemo(() => {
    const out: number[][] = [];
    words.forEach((w, i) => {
      if (i === 0 || w.paraStart) out.push([]);
      out[out.length - 1].push(i);
    });
    return out;
  }, [words]);

  const q = normWord(query);
  const matches = useMemo(() => (q ? words.flatMap((w, i) => (normWord(shown(i)).includes(q) ? [i] : [])) : []), [q, words, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const sameWord = focus !== null ? words.flatMap((w, i) => (normWord(w.word) === normWord(words[focus].word) ? [i] : [])) : [];

  useEffect(() => {
    if (focus === null) return;
    setDraft(shown(focus));
    setApplyAll(false);
    list.current?.querySelector(`[data-w="${focus}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    if (focus === null) return;
    const targets = applyAll ? sameWord : [focus];
    const next = { ...overrides };
    for (const i of targets) {
      if (!draft.trim() || draft === words[i].word) delete next[i];
      else next[i] = draft.trim();
    }
    setOverrides(next);
  };
  const resetAll = () => setOverrides({});
  const active = words.findLastIndex((w) => w.start <= currentTime);

  return (
    <aside className="flex max-h-[min(70vh,640px)] flex-col rounded-lg border border-line bg-panel">
      <div className="border-b border-line p-3">
        <div className="flex items-center gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a word…" className="w-full rounded-md border border-line bg-ink px-3 py-1.5 text-sm outline-none focus:border-amber" />
          {q && <span className="shrink-0 text-xs text-muted">{matches.length} found</span>}
        </div>
        <p className="mt-2 text-xs text-muted">
          Click a word to fix how it shows in the captions. {Object.keys(overrides).length ? `${Object.keys(overrides).length} fix(es).` : "No fixes yet."}
          {Object.keys(overrides).length > 0 && (
            <button onClick={resetAll} className="ml-2 text-amber hover:underline">
              Undo all fixes
            </button>
          )}
        </p>
      </div>

      {focus !== null && (
        <div className="border-b border-line bg-raised/50 p-3">
          <div className="text-xs text-muted">
            Script word: <b className="text-text">{words[focus].word}</b>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && apply()}
              className="w-full rounded-md border border-line bg-ink px-3 py-1.5 text-sm outline-none focus:border-amber"
              aria-label="Caption text for this word"
              autoFocus
            />
            <button onClick={apply} className="shrink-0 rounded-md bg-amber px-3 py-1.5 text-sm font-medium text-ink hover:brightness-110">
              Apply
            </button>
          </div>
          {sameWord.length > 1 && (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={applyAll} onChange={(e) => setApplyAll(e.target.checked)} className="accent-amber" />
              Apply to all {sameWord.length} times “{words[focus].word.replace(/[^\w'-]/g, "")}” appears
            </label>
          )}
          <p className="mt-1 text-[11px] text-muted">Leave it as the script word (or empty) to remove a fix.</p>
        </div>
      )}

      <div ref={list} className="overflow-y-auto p-3 text-sm leading-7">
        {paragraphs.map((para, k) => (
          <p key={k} className="mb-3">
            {para.map((i) => {
              const fixed = overrides[i] !== undefined;
              const hit = q && matches.includes(i);
              return (
                <span key={i}>
                  <button
                    data-w={i}
                    onClick={() => onFocus(i)}
                    className={`rounded px-0.5 ${focus === i ? "bg-amber text-ink" : hit ? "bg-teal/30" : i === active ? "bg-text/15" : "hover:bg-raised"} ${fixed ? "underline decoration-amber decoration-2 underline-offset-4" : ""}`}
                    title={fixed ? `Script: ${words[i].word}` : undefined}
                  >
                    {shown(i)}
                  </button>{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </aside>
  );
}
