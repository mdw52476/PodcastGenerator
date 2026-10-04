"use client";
import { useRef } from "react";
import { Motion, type EditPlan, type ResolvedPlan } from "@shoebox/edit-plan";
import { checkText } from "@shoebox/text-rules";
import type { Selection } from "./Editor";

const label = "mb-1 block text-xs font-semibold tracking-wider text-muted uppercase";
const field = "w-full rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-amber";
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
const MOTION_LABEL: Record<string, string> = {
  push_in: "Push in",
  pull_out: "Pull out",
  drift_left: "Drift left",
  drift_right: "Drift right",
  pan_up: "Pan up",
  static: "Static",
  static_sway: "Static with sway",
};

interface Props {
  plan: EditPlan;
  resolved: ResolvedPlan;
  selection: Selection;
  imageUrls: Record<string, string>;
  change: (fn: (d: EditPlan) => void, opts?: { record?: boolean; group?: string }) => void;
  checkpoint?: () => void;
  onUpload: (shotIndex: number, file: File) => Promise<void> | void;
  seek: (sec: number) => void;
}

function Slider({ label: l, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-muted">
        <span>{l}</span>
        <span className="text-text">
          {value.toFixed(step < 1 ? 1 : 0)} {unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-amber" aria-label={l} />
    </div>
  );
}

export function Inspector({ plan, resolved, selection, imageUrls, change, onUpload, seek }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  // Typing or sliding groups into one undo step per field, not one per keystroke.
  const live = (group: string, fn: (d: EditPlan) => void) => change(fn, { group });

  if (!selection) {
    return (
      <aside className="rounded-lg border border-line bg-panel p-4 text-sm text-muted">
        <p className="font-medium text-text">Nothing selected</p>
        <p className="mt-2">Click a shot, text card or music block in the timeline to edit it.</p>
        <ul className="mt-3 list-disc space-y-1 pl-4">
          <li>Drag the left edge of a shot to move the cut.</li>
          <li>Drag a text card to move it; drag its right edge to change how long it shows.</li>
          <li>Drag the edges of a music block to move where it comes in and out.</li>
          <li>Everything snaps to the start of a word. Ctrl+Z undoes.</li>
        </ul>
      </aside>
    );
  }

  const box = "flex flex-col gap-4 rounded-lg border border-line bg-panel p-4";

  if (selection.kind === "shot") {
    const i = selection.index;
    const s = plan.shots[i];
    const r = resolved.shots[i];
    const src = s.visual.src;
    const uploaded = Object.keys(imageUrls);
    return (
      <aside className={box}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-xl tracking-wide">Shot {s.id}</h3>
          <button onClick={() => seek(r.start)} className="text-xs text-amber hover:underline">
            Jump to {fmt(r.start)}
          </button>
        </div>
        <p className="text-xs text-muted">
          {fmt(r.start)} to {fmt(r.end)} · {(r.end - r.start).toFixed(1)} s{s.cue ? ` · starts on “${s.cue}”` : ""}
        </p>
        {s.visual.prompt && <p className="rounded-md bg-ink px-3 py-2 text-xs leading-relaxed text-muted">{s.visual.prompt}</p>}

        <div>
          <span className={label}>Picture</span>
          {src && imageUrls[src] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrls[src]} alt={`Image for ${s.id}`} className="mb-2 aspect-video w-full rounded-md object-cover" />
          ) : (
            <div className="mb-2 flex aspect-video w-full items-center justify-center rounded-md border border-dashed border-line text-xs text-muted">
              {src ? "Image not available in this preview" : "Placeholder"}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => fileInput.current?.click()} className="rounded-md bg-raised px-3 py-1.5 text-sm hover:brightness-125">
              Upload image
            </button>
            {src && (
              <button onClick={() => change((d) => void (d.shots[i].visual = { ...d.shots[i].visual, src: null }))} className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-raised">
                Use placeholder
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(i, f);
                e.target.value = "";
              }}
            />
          </div>
          {uploaded.length > 0 && (
            <div className="mt-3">
              <span className="text-xs text-muted">Or pick an image already uploaded to this episode:</span>
              <div className="mt-1 grid grid-cols-4 gap-1.5">
                {uploaded.map((rel) => (
                  <button
                    key={rel}
                    onClick={() => change((d) => void (d.shots[i].visual = { ...d.shots[i].visual, type: "image", src: rel }))}
                    className={`overflow-hidden rounded border ${src === rel ? "border-amber" : "border-line hover:border-amber/60"}`}
                    title={rel}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrls[rel]} alt={rel} className="aspect-video w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">JPG, PNG or WebP, 16:9, up to 25 MB. No faces, bodies, logos or readable text (show guardrails).</p>
        </div>

        <div>
          <label className={label} htmlFor="motion">
            Camera move
          </label>
          <select id="motion" value={s.motion} onChange={(e) => change((d) => void (d.shots[i].motion = e.target.value as EditPlan["shots"][number]["motion"]))} className={field}>
            {Motion.options.map((m) => (
              <option key={m} value={m}>
                {MOTION_LABEL[m] ?? m}
              </option>
            ))}
          </select>
        </div>

        {i > 0 && s.startSec !== undefined && s.cue && (
          <button onClick={() => change((d) => void delete d.shots[i].startSec)} className="self-start text-xs text-amber hover:underline">
            Put the cut back on “{s.cue}”
          </button>
        )}
      </aside>
    );
  }

  if (selection.kind === "text") {
    const i = selection.index;
    const t = plan.text[i];
    const r = resolved.text[i];
    const v = checkText(t.text);
    return (
      <aside className={box}>
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-xl tracking-wide capitalize">{t.type.replace(/_/g, " ")}</h3>
          <button onClick={() => seek(r.start)} className="text-xs text-amber hover:underline">
            Jump to {fmt(r.start)}
          </button>
        </div>
        <p className="text-xs text-muted">
          {fmt(r.start)} to {fmt(r.end)} · shows for {(r.end - r.start).toFixed(1)} s{t.untilEnd ? " (to the end)" : ""}
        </p>
        <div>
          <label className={label} htmlFor="cardtext">
            Text
          </label>
          <textarea id="cardtext" rows={3} value={t.text} onChange={(e) => live(`text${i}`, (d) => void (d.text[i].text = e.target.value))} className={`${field} resize-y`} />
          {v.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {v.map((x, k) => (
                <li key={k} className={x.severity === "error" ? "text-danger" : "text-amber"}>
                  {x.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        {t.startSec !== undefined && t.cue && (
          <button onClick={() => change((d) => void delete d.text[i].startSec)} className="self-start text-xs text-amber hover:underline">
            Put it back on “{t.cue}”
          </button>
        )}
      </aside>
    );
  }

  const i = selection.index;
  const m = plan.music[i];
  const r = resolved.music[i];
  return (
    <aside className={box}>
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-xl tracking-wide">{m.track}</h3>
        <button onClick={() => seek(r.start)} className="text-xs text-amber hover:underline">
          Jump to {fmt(r.start)}
        </button>
      </div>
      <p className="text-xs text-muted">
        In at {fmt(r.start)}, out at {fmt(r.end)} (then fades for {r.fadeOutSec} s)
      </p>
      <Slider label="Fade in" value={r.fadeInSec} min={0} max={6} step={0.25} unit="s" onChange={(v) => live(`music${i}.fadeInSec`, (d) => void (d.music[i].fadeInSec = v))} />
      <Slider label="Fade out" value={r.fadeOutSec} min={0} max={8} step={0.25} unit="s" onChange={(v) => live(`music${i}.fadeOutSec`, (d) => void (d.music[i].fadeOutSec = v))} />
      <Slider label="Level between lines" value={r.levelDb} min={-30} max={-3} step={1} unit="dB" onChange={(v) => live(`music${i}.levelDb`, (d) => void (d.music[i].levelDb = v))} />
      <Slider label="Dip under Walt's voice" value={r.duckUnderVoiceDb} min={-30} max={0} step={1} unit="dB" onChange={(v) => live(`music${i}.duckUnderVoiceDb`, (d) => void (d.music[i].duckUnderVoiceDb = v))} />
      <p className="text-xs text-muted">Higher level = louder music. A bigger dip = quieter under the voice. Play the preview to hear changes.</p>
      {(m.startSec !== undefined || m.endSec !== undefined) && (m.cueStart || m.cueEnd) && (
        <button
          onClick={() =>
            change((d) => {
              if (d.music[i].cueStart) delete d.music[i].startSec;
              if (d.music[i].cueEnd) delete d.music[i].endSec;
            })
          }
          className="self-start text-xs text-amber hover:underline"
        >
          Put the edges back on their cues
        </button>
      )}
    </aside>
  );
}
