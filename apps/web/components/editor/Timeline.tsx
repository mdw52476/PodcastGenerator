"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { snapToWord, type EditPlan, type ResolvedPlan, type WordTiming } from "@shoebox/edit-plan";
import type { Selection } from "./Editor";
import { useWaveform } from "./useWaveform";

const LANE = { wave: 72, shots: 44, text: 34, captions: 30, music: 44 };
const LABEL_W = 84;
const MIN_SHOT = 1.0;
const MIN_TEXT = 1.0;
const MIN_MUSIC = 3.0;

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

interface Props {
  resolved: ResolvedPlan;
  words: WordTiming[];
  narrationUrl: string;
  frame: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSeek: (sec: number) => void;
  onCaptionClick: (wordIndex: number) => void;
  checkpoint: () => void;
  change: (fn: (d: EditPlan) => void, opts?: { record?: boolean; group?: string }) => void;
}

/**
 * Narration waveform with word markers, plus lanes for shots, text cards,
 * captions and music. Edges and blocks drag on word boundaries.
 */
export function Timeline({ resolved, words, narrationUrl, frame, selection, onSelect, onSeek, onCaptionClick, checkpoint, change }: Props) {
  const [zoom, setZoom] = useState(14); // px per second
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const peaks = useWaveform(narrationUrl);
  const dur = resolved.durationSec;
  const width = Math.ceil(dur * zoom);
  const now = frame / resolved.fps;
  const x = (t: number) => t * zoom;

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const px = x(now);
    if (px < el.scrollLeft || px > el.scrollLeft + el.clientWidth - LABEL_W - 40) el.scrollLeft = Math.max(0, px - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.floor(now)]);

  const timeAt = (clientX: number) => {
    const r = content.current!.getBoundingClientRect();
    return Math.min(dur, Math.max(0, (clientX - r.left) / zoom));
  };

  /** Pointer drag helper: one undo step per drag (recorded on the first real move), live updates while moving. */
  const drag = (e: React.PointerEvent, onMove: (t: number) => void) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Not a real pointer (e.g. synthetic events); dragging still works without capture.
    }
    const x0 = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return; // a click, not a drag
      if (!moved) checkpoint();
      moved = true;
      onMove(timeAt(ev.clientX));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const snap = (t: number) => snapToWord(words, t, "start");
  const snapEnd = (t: number) => snapToWord(words, t, "end");

  const wavePath = useMemo(() => {
    if (!peaks?.length) return "";
    const h = 50;
    let d = `M0 ${h}`;
    peaks.forEach((p, i) => (d += ` L${i} ${h - p * h}`));
    for (let i = peaks.length - 1; i >= 0; i--) d += ` L${i} ${h + peaks[i] * h}`;
    return d + " Z";
  }, [peaks]);

  const sel = (kind: NonNullable<Selection>["kind"], index: number) => selection?.kind === kind && selection.index === index;
  const ticks = useMemo(() => {
    const step = zoom >= 40 ? 5 : zoom >= 12 ? 15 : 30;
    return Array.from({ length: Math.floor(dur / step) + 1 }, (_, i) => i * step);
  }, [zoom, dur]);

  const laneLabel = (text: string, h: number) => (
    <div className="flex items-center border-b border-line px-2 text-[11px] font-semibold tracking-wider text-muted uppercase" style={{ height: h }}>
      {text}
    </div>
  );

  return (
    <section className="rounded-lg border border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm">
        <span className="text-muted">
          {fmt(now)} / {fmt(dur)}
        </span>
        <span className="text-xs text-muted">· drag edges to move cuts (snaps to words) · click to select · click the ruler to jump</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setZoom((z) => Math.max(3, z / 1.5))} className="rounded px-2 py-0.5 hover:bg-raised" aria-label="Zoom out">
            −
          </button>
          <span className="w-16 text-center text-xs text-muted">{Math.round(zoom)} px/s</span>
          <button onClick={() => setZoom((z) => Math.min(160, z * 1.5))} className="rounded px-2 py-0.5 hover:bg-raised" aria-label="Zoom in">
            +
          </button>
        </div>
      </div>

      <div className="flex">
        {/* Lane labels */}
        <div className="shrink-0 border-r border-line" style={{ width: LABEL_W }}>
          <div className="h-6 border-b border-line" />
          {laneLabel("Voice", LANE.wave)}
          {laneLabel("Shots", LANE.shots)}
          {laneLabel("Text", LANE.text)}
          {laneLabel("Captions", LANE.captions)}
          {laneLabel("Music", LANE.music)}
        </div>

        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
          <div ref={content} className="relative select-none" style={{ width }}>
            {/* Ruler */}
            <div className="relative h-6 cursor-pointer border-b border-line" onPointerDown={(e) => onSeek(timeAt(e.clientX))}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-line pl-1 text-[10px] text-muted" style={{ left: x(t) }}>
                  {fmt(t)}
                </div>
              ))}
            </div>

            {/* Voice: waveform + word markers */}
            <div className="relative border-b border-line" style={{ height: LANE.wave }} onPointerDown={(e) => onSeek(timeAt(e.clientX))}>
              {peaks?.length ? (
                <svg className="absolute inset-0" width={width} height={LANE.wave} viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none">
                  <path d={wavePath} fill="rgba(95,168,168,0.45)" />
                </svg>
              ) : (
                <div className="p-2 text-xs text-muted">{peaks ? "Waveform unavailable" : "Loading waveform…"}</div>
              )}
              {words.map((w, i) => (
                <div key={i} className="absolute bottom-0 h-2 border-l border-text/25" style={{ left: x(w.start) }} />
              ))}
              {zoom >= 45 &&
                words.map((w, i) => (
                  <div key={`l${i}`} className="pointer-events-none absolute top-0.5 truncate text-[10px] text-text/70" style={{ left: x(w.start) + 2, maxWidth: Math.max(8, x(w.end - w.start)) }}>
                    {w.word}
                  </div>
                ))}
            </div>

            {/* Shots */}
            <div className="relative border-b border-line" style={{ height: LANE.shots }}>
              {resolved.shots.map((s, i) => (
                <div
                  key={s.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: "shot", index: i });
                  }}
                  className={`absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded border px-1.5 text-[11px] leading-tight ${sel("shot", i) ? "border-amber bg-amber/20" : s.src ? "border-teal/50 bg-teal/15" : "border-line bg-raised"}`}
                  style={{ left: x(s.start), width: Math.max(2, x(s.end - s.start) - 1) }}
                  title={`${s.id} · ${s.motion} · ${s.prompt ?? ""}`}
                >
                  <div className="truncate font-medium">{s.id}</div>
                  <div className="truncate text-muted">{s.src ? "image" : "placeholder"} · {s.motion}</div>
                  {i > 0 && (
                    <div
                      className="absolute top-0 left-0 h-full w-2 cursor-ew-resize bg-text/0 hover:bg-amber/60"
                      onPointerDown={(e) =>
                        drag(e, (t) => {
                          const prev = resolved.shots[i - 1];
                          const v = Math.min(s.end - MIN_SHOT, Math.max(prev.start + MIN_SHOT, snap(t)));
                          change((d) => void (d.shots[i].startSec = Math.round(v * 1000) / 1000), { record: false });
                        })
                      }
                      title="Drag to move this cut"
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Text cards */}
            <div className="relative border-b border-line" style={{ height: LANE.text }}>
              {resolved.text.map((t, i) => {
                const raw = (d: EditPlan) => d.text[i];
                return (
                  <div
                    key={i}
                    onPointerDown={(e) => {
                      onSelect({ kind: "text", index: i });
                      const grab = timeAt(e.clientX) - t.start;
                      const len = t.end - t.start;
                      drag(e, (tt) => {
                        const v = Math.min(dur - len, Math.max(0, snap(tt - grab)));
                        change(
                          (d) => {
                            const item = raw(d);
                            item.startSec = Math.round(v * 1000) / 1000;
                            if (item.untilEnd) return;
                            if (item.endSec !== undefined) item.endSec = Math.round((v + len) * 1000) / 1000;
                            else item.durationSec = Math.round(len * 1000) / 1000;
                          },
                          { record: false },
                        );
                      });
                    }}
                    className={`absolute top-1 bottom-1 cursor-grab overflow-hidden rounded border px-1.5 text-[11px] leading-[22px] ${sel("text", i) ? "border-amber bg-amber/20" : "border-line bg-raised"}`}
                    style={{ left: x(t.start), width: Math.max(4, x(t.end - t.start) - 1) }}
                    title={`${t.type}: ${t.text}`}
                  >
                    <span className="truncate">{t.text}</span>
                    {!textUntilEnd(resolved, i) && (
                      <div
                        className="absolute top-0 right-0 h-full w-2 cursor-ew-resize hover:bg-amber/60"
                        onPointerDown={(e) =>
                          drag(e, (tt) => {
                            const end = Math.min(dur, Math.max(t.start + MIN_TEXT, snapEnd(tt)));
                            change(
                              (d) => {
                                const item = raw(d);
                                if (item.endSec !== undefined) item.endSec = Math.round(end * 1000) / 1000;
                                else item.durationSec = Math.round((end - t.start) * 1000) / 1000;
                              },
                              { record: false },
                            );
                          })
                        }
                        title="Drag to change how long it shows"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Captions (read-only here; click to fix words in the Captions tab) */}
            <div className="relative border-b border-line" style={{ height: LANE.captions }}>
              {resolved.captions.pages.map((p, i) => (
                <div
                  key={i}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onCaptionClick(p.lines[0][0].index);
                  }}
                  className="absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded-sm bg-text/10 px-1 text-[10px] leading-[20px] text-text/70 hover:bg-text/20"
                  style={{ left: x(p.start), width: Math.max(2, x(p.end - p.start) - 1) }}
                  title={p.lines.map((l) => l.map((w) => w.text).join(" ")).join(" / ")}
                >
                  {zoom >= 20 ? p.lines.flat().map((w) => w.text).join(" ") : ""}
                </div>
              ))}
            </div>

            {/* Music */}
            <div className="relative" style={{ height: LANE.music }}>
              {resolved.music.map((m, i) => {
                const tail = m.end + m.fadeOutSec;
                return (
                  <div
                    key={i}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelect({ kind: "music", index: i });
                    }}
                    className={`absolute top-1 bottom-1 cursor-pointer overflow-hidden rounded border text-[11px] ${sel("music", i) ? "border-amber bg-amber/15" : "border-line bg-raised"}`}
                    style={{ left: x(m.start), width: Math.max(4, x(Math.min(dur, tail) - m.start)) }}
                    title={`${m.track}: ${fmt(m.start)} to ${fmt(m.end)}`}
                  >
                    {/* fade ramps */}
                    <svg className="pointer-events-none absolute inset-0" width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 10">
                      <path
                        d={`M0 10 L${(m.fadeInSec / (tail - m.start)) * 100} 2 L${((m.end - m.start) / (tail - m.start)) * 100} 2 L100 10 Z`}
                        fill="rgba(232,163,61,0.18)"
                      />
                    </svg>
                    <div className="relative truncate px-1.5 leading-[34px]">{m.track}</div>
                    <div
                      className="absolute top-0 left-0 h-full w-2 cursor-ew-resize hover:bg-amber/60"
                      onPointerDown={(e) =>
                        drag(e, (t) => {
                          const v = Math.min(m.end - MIN_MUSIC, Math.max(0, snap(t)));
                          change((d) => void (d.music[i].startSec = Math.round(v * 1000) / 1000), { record: false });
                        })
                      }
                      title="Drag to move where this music starts"
                    />
                    {!resolvedUntilEnd(resolved, i) && (
                      <div
                        className="absolute top-0 h-full w-2 cursor-ew-resize hover:bg-amber/60"
                        style={{ left: x(m.end - m.start) - 4 }}
                        onPointerDown={(e) =>
                          drag(e, (t) => {
                            const v = Math.min(dur, Math.max(m.start + MIN_MUSIC, snap(t)));
                            change((d) => void (d.music[i].endSec = Math.round(v * 1000) / 1000), { record: false });
                          })
                        }
                        title="Drag to move where this music ends (it then fades out)"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Playhead */}
            <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-amber" style={{ left: x(now) }} />
          </div>
        </div>
      </div>
    </section>
  );
}

// Items that run to the end of the episode have no draggable right edge.
const textUntilEnd = (r: ResolvedPlan, i: number) => Math.abs(r.text[i].end - r.durationSec) < 0.01;
const resolvedUntilEnd = (r: ResolvedPlan, i: number) => Math.abs(r.music[i].end - r.durationSec) < 0.01;
