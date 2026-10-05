"use client";
import { useState, useTransition } from "react";
import { profileTextIssues, type ShowProfile } from "@shoebox/edit-plan";
import { checkText } from "@shoebox/text-rules";
import { saveShow } from "@/app/shows/actions";

const field = "w-full rounded-md border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-amber";
const lab = "flex flex-col gap-1 text-xs text-muted";
const section = "rounded-lg border border-line bg-panel p-4";
const h2 = "mb-3 text-sm font-semibold tracking-wider text-muted uppercase";

function Rules({ text }: { text: string | null }) {
  const v = text ? checkText(text) : [];
  return v.length ? (
    <span className={v.some((x) => x.severity === "error") ? "text-danger" : "text-amber"}>{v.map((x) => x.message).join("; ")}</span>
  ) : null;
}

/** The show profile as a form. Saving checks on-screen text against the text rules. */
export function ShowForm({ id, initial }: { id: string; initial: ShowProfile }) {
  const [p, setP] = useState<ShowProfile>(initial);
  const [saved, setSaved] = useState(initial);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof ShowProfile>(k: K, v: ShowProfile[K]) => setP((x) => ({ ...x, [k]: v }));
  const sub = <K extends "narrator" | "voice" | "look" | "captions" | "music" | "shorts">(k: K, patch: Partial<ShowProfile[K]>) =>
    setP((x) => ({ ...x, [k]: { ...x[k], ...patch } }));
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const problems = profileTextIssues(p);
  const dirty = JSON.stringify(p) !== JSON.stringify(saved);

  const save = () =>
    start(async () => {
      setMessage(null);
      try {
        await saveShow(id, p);
        setSaved(p);
        setMessage({ tone: "ok", text: "Saved. New episodes and re-voicing use these settings." });
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
      }
    });

  const slider = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, hint?: string) => (
    <label className={lab}>
      <span className="flex justify-between">
        {label}
        <span className="text-text">{value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-amber" />
      {hint && <span>{hint}</span>}
    </label>
  );

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-line bg-ink/95 px-4 py-2.5 backdrop-blur">
        <h1 className="font-display text-2xl tracking-wide">{p.name || "Untitled show"}</h1>
        <button onClick={save} disabled={pending || !dirty || problems.length > 0} className="ml-auto rounded-md bg-amber px-4 py-1.5 text-sm font-medium text-ink hover:brightness-110 disabled:opacity-40">
          {dirty ? "Save settings" : "Saved"}
        </button>
        {problems.length > 0 && <span className="w-full text-sm text-danger">{problems.join("; ")}</span>}
        {message && <span className={`w-full text-sm ${message.tone === "ok" ? "text-ok" : "text-danger"}`}>{message.text}</span>}
      </div>

      <section className={section}>
        <h2 className={h2}>Show</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={lab}>
            Name
            <input value={p.name} onChange={(e) => set("name", e.target.value)} className={field} />
          </label>
          <label className={lab}>
            Title card (on screen)
            <input value={p.titleCard} onChange={(e) => set("titleCard", e.target.value)} className={field} />
            <Rules text={p.titleCard} />
          </label>
          <label className={`${lab} sm:col-span-2`}>
            AI disclosure (on screen for the first 10 seconds; leave empty for none)
            <input value={p.disclosureText ?? ""} onChange={(e) => set("disclosureText", e.target.value || null)} className={field} />
            <Rules text={p.disclosureText} />
          </label>
          <label className={lab}>
            Release cadence
            <input value={p.cadence} onChange={(e) => set("cadence", e.target.value)} className={field} />
          </label>
          <label className={lab}>
            Target length (minutes)
            <input type="number" min={1} value={p.targetMinutes} onChange={(e) => set("targetMinutes", num(e.target.value))} className={field} />
          </label>
        </div>
      </section>

      <section className={section}>
        <h2 className={h2}>Narrator and voice</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={lab}>
            Narrator name
            <input value={p.narrator.name} onChange={(e) => sub("narrator", { name: e.target.value })} className={field} />
          </label>
          <label className={lab}>
            ElevenLabs voice id
            <input value={p.voice.voiceId} onChange={(e) => sub("voice", { voiceId: e.target.value.trim() })} className={field} />
            <span>{p.voice.voiceName}</span>
          </label>
          <label className={`${lab} sm:col-span-2`}>
            Who the narrator is
            <textarea rows={2} value={p.narrator.identity} onChange={(e) => sub("narrator", { identity: e.target.value })} className={`${field} resize-y`} />
          </label>
          {slider("Speed", p.voice.speed, 0.7, 1.2, 0.01, (v) => sub("voice", { speed: v }), "1.0 is normal; The Shoebox Files uses 0.88 (~140 words a minute).")}
          {slider("Stability", p.voice.stability, 0, 1, 0.05, (v) => sub("voice", { stability: v }), "Lower = more expressive, higher = steadier.")}
          {slider("Similarity", p.voice.similarity, 0, 1, 0.05, (v) => sub("voice", { similarity: v }))}
          {slider("Style", p.voice.style, 0, 1, 0.05, (v) => sub("voice", { style: v }))}
        </div>
      </section>

      <section className={section}>
        <h2 className={h2}>Spoken lines (for the script writer)</h2>
        <div className="grid gap-3">
          {(["opener", "closer", "disclaimer"] as const).map((k) => (
            <label key={k} className={lab}>
              <span className="capitalize">{k}</span>
              <textarea rows={2} value={p[k]} onChange={(e) => set(k, e.target.value)} className={`${field} resize-y`} />
              <Rules text={p[k]} />
            </label>
          ))}
        </div>
      </section>

      <section className={section}>
        <h2 className={h2}>Look</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={lab}>
            Colour grade
            <select value={p.look.tint} onChange={(e) => sub("look", { tint: e.target.value as ShowProfile["look"]["tint"] })} className={field}>
              <option value="teal-shadows-amber-highlights">Teal shadows, amber highlights</option>
              <option value="neutral">Neutral</option>
              <option value="warm">Warm</option>
              <option value="cool">Cool</option>
            </select>
          </label>
          {slider("Saturation", p.look.saturation, 0, 1.5, 0.05, (v) => sub("look", { saturation: v }))}
          {slider("Contrast", p.look.contrast, 0.8, 1.4, 0.01, (v) => sub("look", { contrast: v }))}
          {slider("Vignette", p.look.vignette, 0, 0.6, 0.01, (v) => sub("look", { vignette: v }))}
          {slider("Film grain", p.look.grain, 0, 0.4, 0.01, (v) => sub("look", { grain: v }))}
          {slider("Glow on highlights", p.look.halation, 0, 0.4, 0.01, (v) => sub("look", { halation: v }))}
          <label className={lab}>
            Caption colour
            <input type="color" value={p.captions.color} onChange={(e) => sub("captions", { color: e.target.value.toUpperCase() })} className="h-9 w-20 rounded border border-line bg-ink" />
          </label>
          <label className={lab}>
            Caption highlight (the word being spoken)
            <input type="color" value={p.captions.highlightColor} onChange={(e) => sub("captions", { highlightColor: e.target.value.toUpperCase() })} className="h-9 w-20 rounded border border-line bg-ink" />
          </label>
        </div>
      </section>

      <section className={section}>
        <h2 className={h2}>Music</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={lab}>
            Bed
            <select value={p.music.preset} onChange={(e) => sub("music", { preset: e.target.value as "dark" | "lighter" })} className={field}>
              <option value="dark">Dark (A minor)</option>
              <option value="lighter">Lighter (C major)</option>
            </select>
          </label>
          <label className={lab}>
            Variation (seed)
            <input type="number" value={p.music.seed} onChange={(e) => sub("music", { seed: Math.round(num(e.target.value)) })} className={field} />
          </label>
          {slider("Dip under the voice (dB)", p.music.duckUnderVoiceDb, -30, 0, 1, (v) => sub("music", { duckUnderVoiceDb: v }))}
        </div>
      </section>

      <section className={section}>
        <h2 className={h2}>Shorts</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={`${lab} sm:col-span-2`}>
            End card text
            <input value={p.shorts.endCardText} onChange={(e) => sub("shorts", { endCardText: e.target.value })} className={field} />
            <Rules text={p.shorts.endCardText} />
          </label>
          <label className={lab}>
            Shorts per episode
            <input type="number" min={0} max={20} value={p.shorts.count} onChange={(e) => sub("shorts", { count: Math.round(num(e.target.value)) })} className={field} />
          </label>
          <label className={lab}>
            Default platform
            <select value={p.shorts.platform} onChange={(e) => sub("shorts", { platform: e.target.value as ShowProfile["shorts"]["platform"] })} className={field}>
              <option value="youtube_shorts">YouTube Shorts</option>
              <option value="tiktok">TikTok</option>
              <option value="reels">Instagram Reels</option>
            </select>
          </label>
        </div>
      </section>

      <section className={section}>
        <h2 className={h2}>Autopilot</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.autopilot.enabled} onChange={(e) => setP((x) => ({ ...x, autopilot: { ...x.autopilot, enabled: e.target.checked } }))} className="accent-amber" />
          The scheduled writer pitches ideas for this show and writes the ones you approve
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className={lab}>
            Ideas per batch
            <input type="number" min={1} max={10} value={p.autopilot.ideasPerBatch} onChange={(e) => setP((x) => ({ ...x, autopilot: { ...x.autopilot, ideasPerBatch: Math.round(num(e.target.value)) } }))} className={field} />
          </label>
          <label className={lab}>
            Shot pictures
            <select value={p.autopilot.imageModel} onChange={(e) => setP((x) => ({ ...x, autopilot: { ...x.autopilot, imageModel: e.target.value as ShowProfile["autopilot"]["imageModel"] } }))} className={field}>
              <option value="flux-schnell">FLUX schnell (~$0.15 per episode)</option>
              <option value="flux-2-pro">FLUX.2 Pro (~$1.20 per episode, better)</option>
              <option value="none">None (placeholders)</option>
            </select>
          </label>
          <label className={lab}>
            Shorts to render automatically
            <input type="number" min={0} max={20} value={p.autopilot.shortsToRender} onChange={(e) => setP((x) => ({ ...x, autopilot: { ...x.autopilot, shortsToRender: Math.round(num(e.target.value)) } }))} className={field} />
          </label>
          <label className={`${lab} sm:col-span-3`}>
            What to look for (topics, regions, eras, anything to avoid)
            <textarea rows={3} value={p.autopilot.ideaBrief} onChange={(e) => setP((x) => ({ ...x, autopilot: { ...x.autopilot, ideaBrief: e.target.value } }))} className={`${field} resize-y`} />
          </label>
          <label className={`${lab} sm:col-span-3`}>
            Picture style (added to every image prompt)
            <textarea rows={2} value={p.visualStyle} onChange={(e) => set("visualStyle", e.target.value)} className={`${field} resize-y`} />
          </label>
        </div>
      </section>

      <section className={section}>
        <h2 className={h2}>Never show (picture guardrails)</h2>
        <textarea
          rows={3}
          value={p.neverShow.join(", ")}
          onChange={(e) => set("neverShow", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
          className={`${field} resize-y`}
        />
        <p className="mt-1 text-xs text-muted">Comma separated. Used when writing image prompts and in the pre-render checklist.</p>
      </section>
    </div>
  );
}
