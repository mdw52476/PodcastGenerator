"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Player, type PlayerRef } from "@remotion/player";
import { Episode } from "@shoebox/engine/episode";
import { resolvePlan, type EditPlan, type Issue, type ResolvedPlan, type WordTiming } from "@shoebox/edit-plan";
import { queueJob } from "@/app/episodes/[id]/actions";
import { registerImage, savePlanEdits } from "@/app/episodes/[id]/edit/actions";
import { supabaseBrowser } from "@/lib/supabase/client";
import { CaptionsPanel } from "./CaptionsPanel";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";

export type Selection = { kind: "shot" | "text" | "music"; index: number } | null;

export interface EditorProps {
  episodeId: string;
  initialPlan: EditPlan;
  words: WordTiming[];
  /** Files from the last preview bundle: signed URLs and how long each music bed lasts. */
  bundle: { narration: string; music: Array<{ url: string; seconds: number }> };
  imageUrls: Record<string, string>;
  placeholderLabels: boolean;
}

const MAX_UNDO = 60;

export function Editor({ episodeId, initialPlan, words, bundle, imageUrls: initialImages, placeholderLabels }: EditorProps) {
  const router = useRouter();
  const [plan, setPlan] = useState<EditPlan>(initialPlan);
  const [saved, setSaved] = useState<EditPlan>(initialPlan);
  const [undo, setUndo] = useState<EditPlan[]>([]);
  const [redo, setRedo] = useState<EditPlan[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [tab, setTab] = useState<"timeline" | "captions">("timeline");
  const [captionFocus, setCaptionFocus] = useState<number | null>(null);
  const [imageUrls, setImageUrls] = useState(initialImages);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [frame, setFrame] = useState(0);
  const playerRef = useRef<PlayerRef>(null);
  const dirty = plan !== saved;

  /** Record the current plan as an undo step (drags call this once, on their first move). */
  const checkpoint = useCallback(() => {
    setUndo((u) => [...u.slice(-MAX_UNDO + 1), plan]);
    setRedo([]);
  }, [plan]);

  /**
   * Apply a change. `record: false` skips the undo step (drag moves after the checkpoint).
   * `group`: consecutive changes with the same group within 2 s share one undo step
   * (typing in a field, moving a slider).
   */
  const lastGroup = useRef<{ key: string; at: number } | null>(null);
  const change = useCallback(
    (fn: (draft: EditPlan) => void, opts: { record?: boolean; group?: string } = {}) => {
      const now = Date.now();
      let record = opts.record ?? true;
      if (opts.group) {
        record = !(lastGroup.current?.key === opts.group && now - lastGroup.current.at < 2000);
        lastGroup.current = { key: opts.group, at: now };
      } else if (record) lastGroup.current = null;
      if (record) checkpoint();
      setPlan((p) => {
        const draft = structuredClone(p);
        fn(draft);
        return draft;
      });
    },
    [checkpoint],
  );
  const doUndo = useCallback(() => {
    if (!undo.length) return;
    lastGroup.current = null;
    setRedo([plan, ...redo]);
    setPlan(undo[undo.length - 1]);
    setUndo(undo.slice(0, -1));
  }, [undo, redo, plan]);
  const doRedo = useCallback(() => {
    if (!redo.length) return;
    lastGroup.current = null;
    setUndo([...undo, plan]);
    setPlan(redo[0]);
    setRedo(redo.slice(1));
  }, [undo, redo, plan]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing || !(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) (e.preventDefault(), doUndo());
      else if (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey)) (e.preventDefault(), doRedo());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Resolve on every edit. If an edit breaks resolution, keep showing the last good preview.
  const lastGood = useRef<ResolvedPlan | null>(null);
  const { resolved, issues } = useMemo(() => {
    const r = resolvePlan(plan, words, { allowPlaceholders: true, musicSrc: (_m, i) => bundle.music[i]?.url ?? "" });
    const ok = !r.issues.some((i) => i.level === "error");
    const res = r.resolved;
    res.narrationSrc = bundle.narration;
    for (const s of res.shots) if (s.src) s.src = imageUrls[s.src] ?? null;
    if (ok) lastGood.current = res;
    return { resolved: ok ? res : lastGood.current ?? res, issues: r.issues };
  }, [plan, words, bundle, imageUrls]);
  const errors = issues.filter((i: Issue) => i.level === "error" && !i.message.includes("placeholder"));

  // Music edges moved past the end of the generated bed: the preview runs out early until refreshed.
  const musicStale = resolved.music.some((m, i) => bundle.music[i] && m.end + m.fadeOutSec - m.start > bundle.music[i].seconds + 0.5);

  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener("frameupdate", onFrame);
    p.addEventListener("seeked", onFrame);
    return () => {
      p.removeEventListener("frameupdate", onFrame);
      p.removeEventListener("seeked", onFrame);
    };
  }, []);
  const seek = useCallback((sec: number) => playerRef.current?.seekTo(Math.max(0, Math.round(sec * resolved.fps))), [resolved.fps]);

  const save = (thenRefresh: boolean) =>
    start(async () => {
      setMessage(null);
      try {
        await savePlanEdits(episodeId, { shots: plan.shots, text: plan.text, music: plan.music, captionOverrides: plan.captions.overrides ?? {} });
        setSaved(plan);
        if (thenRefresh) await queueJob(episodeId, "prepare");
        setMessage({ tone: "ok", text: thenRefresh ? "Saved. The preview music is being rebuilt on Railway (about 2 minutes); reload this page after that." : "Saved." });
        router.refresh();
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
      }
    });

  /** Upload a shot image straight to storage, register it with the episode, and point the shot at it. */
  const uploadImage = async (shotIndex: number, file: File) => {
    setMessage(null);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return setMessage({ tone: "error", text: "Use a JPG, PNG or WebP image." });
    if (file.size > 25 * 1024 * 1024) return setMessage({ tone: "error", text: "That image is over 25 MB." });
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", await file.arrayBuffer())))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);
    const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-|-$/g, "").slice(-60);
    const rel = `images/${hash}-${safe}`;
    const key = `inputs/${episodeId}/${rel}`;
    const sb = supabaseBrowser();
    const { error } = await sb.storage.from("studio").upload(key, file, { upsert: true, contentType: file.type });
    if (error) return setMessage({ tone: "error", text: `Upload failed: ${error.message}` });
    await registerImage(episodeId, rel, key);
    const { data } = await sb.storage.from("studio").createSignedUrl(key, 6 * 3600);
    if (data) setImageUrls((u) => ({ ...u, [rel]: data.signedUrl }));
    change((d) => {
      d.shots[shotIndex].visual = { ...d.shots[shotIndex].visual, type: "image", src: rel };
    });
  };

  const btn = "rounded-md px-3 py-1.5 text-sm disabled:opacity-40";
  return (
    <div className="mt-3 flex flex-col gap-4">
      {/* Action bar */}
      <div className="sticky top-14 z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-line bg-ink/95 px-4 py-2.5 backdrop-blur">
        <button onClick={doUndo} disabled={!undo.length} className={`${btn} hover:bg-raised`} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button onClick={doRedo} disabled={!redo.length} className={`${btn} hover:bg-raised`} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button onClick={() => save(false)} disabled={pending || !dirty || errors.length > 0} className={`${btn} bg-raised font-medium hover:brightness-125`}>
          {dirty ? "Save" : "Saved"}
        </button>
        <button onClick={() => save(true)} disabled={pending || errors.length > 0} className={`${btn} border border-line hover:border-amber/60`}>
          Save &amp; refresh preview
        </button>
        {errors.length > 0 && <span className="text-sm text-danger">{errors.length} problem(s) to fix before saving</span>}
        {musicStale && !errors.length && <span className="text-sm text-amber">Music edges moved: save &amp; refresh to rebuild the music for the preview.</span>}
        {message && <span className={`text-sm ${message.tone === "ok" ? "text-ok" : "text-danger"}`}>{message.text}</span>}
        <div className="ml-auto flex rounded-md border border-line p-0.5 text-sm">
          {(["timeline", "captions"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1 capitalize ${tab === t ? "bg-raised text-text" : "text-muted hover:text-text"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {errors.length > 0 && (
        <ul className="rounded-md border border-danger/40 bg-danger/10 px-4 py-2 text-sm">
          {errors.map((e, i) => (
            <li key={i}>
              <b>{e.where}</b>: {e.message}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="mx-auto w-full overflow-hidden rounded-lg border border-line bg-black" style={{ maxWidth: "calc((100dvh - 420px) * 16 / 9)" }}>
          <Player
            ref={playerRef}
            component={Episode}
            inputProps={{ plan: resolved, placeholderLabels }}
            durationInFrames={Math.ceil(resolved.durationSec * resolved.fps)}
            fps={resolved.fps}
            compositionWidth={resolved.width}
            compositionHeight={resolved.height}
            style={{ width: "100%", aspectRatio: "16 / 9" }}
            controls
            clickToPlay
            spaceKeyToPlayOrPause
            showVolumeControls
            acknowledgeRemotionLicense
          />
        </div>
        {tab === "timeline" ? (
          <Inspector
            plan={plan}
            resolved={resolved}
            selection={selection}
            imageUrls={imageUrls}
            change={change}
            checkpoint={checkpoint}
            onUpload={uploadImage}
            seek={seek}
          />
        ) : (
          <CaptionsPanel
            words={words}
            overrides={plan.captions.overrides ?? {}}
            focus={captionFocus}
            onFocus={(i) => {
              setCaptionFocus(i);
              seek(words[i].start);
            }}
            setOverrides={(next) =>
              change((d) => {
                d.captions.overrides = Object.keys(next).length ? next : undefined;
              })
            }
            currentTime={frame / resolved.fps}
          />
        )}
      </div>

      <Timeline
        resolved={resolved}
        words={words}
        narrationUrl={bundle.narration}
        frame={frame}
        selection={selection}
        onSelect={(s) => {
          setSelection(s);
          setTab("timeline");
        }}
        onSeek={seek}
        onCaptionClick={(wordIndex) => {
          setTab("captions");
          setCaptionFocus(wordIndex);
        }}
        checkpoint={checkpoint}
        change={change}
      />
    </div>
  );
}
