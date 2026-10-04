import { checkText, type Violation } from "@shoebox/text-rules";
import { chunkCaptions, type CaptionPage } from "./captions";
import { CueIndex } from "./cues";
import { autoHook } from "./shorts";
import type { EditPlan, Motion, MusicItem, Platform, Short, WordTiming } from "./schema";

/**
 * A plan with every cue turned into seconds. This is what the Remotion
 * composition renders, so the browser preview and the final render share it.
 */
export interface ResolvedPlan {
  episodeId: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  narrationSrc: string;
  grade: EditPlan["style"]["grade"];
  crossfadeSec: number;
  shots: Array<{
    id: string;
    index: number;
    start: number;
    end: number;
    motion: Motion;
    shotType?: string;
    src: string | null;
    mediaType: "image" | "video";
    prompt?: string;
  }>;
  text: Array<{ type: string; text: string; start: number; end: number }>;
  captions: {
    enabled: boolean;
    color: string;
    highlightColor: string;
    pages: CaptionPage[];
    /** Display-text fixes keyed by word index (the captions panel writes these). */
    overrides: Record<string, string>;
  };
  music: Array<{
    track: string;
    src: string;
    start: number;
    end: number;
    fadeInSec: number;
    fadeOutSec: number;
    levelDb: number;
    duckUnderVoiceDb: number;
    generator?: MusicItem["generator"];
  }>;
  /** Merged spans where Walt is speaking; music ducks inside these. */
  voiceSpans: Array<[number, number]>;
  shorts: Array<
    Omit<Short, "cueStart" | "cueEnd" | "startSec" | "endSec"> & { start: number; end: number; cueStart: string; cueEnd: string; hookAuto?: boolean }
  >;
  shortsDefaults: { endCardText: string; platform: Platform };
  /** Script words with times (as written); shorts re-chunk captions from these plus captions.overrides. */
  words: WordTiming[];
}

export interface Issue {
  level: "error" | "warning";
  where: string;
  message: string;
  violations?: Violation[];
}

export interface ResolveOptions {
  /** Phase 1: shots without a source render as graded placeholders instead of failing. */
  allowPlaceholders?: boolean;
  /** Maps a music item to the file the renderer will load (filled in after beds are generated). */
  musicSrc?: (m: MusicItem, i: number) => string;
}

const DEFAULT_LEVEL_DB: Record<string, number> = { "show-theme": -9, bed: -13 };

/** Join word spans separated by less than `gap` seconds. */
export function voiceSpans(words: WordTiming[], gap = 0.45): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const w of words) {
    const last = spans[spans.length - 1];
    if (last && w.start - last[1] < gap) last[1] = Math.max(last[1], w.end);
    else spans.push([w.start, w.end]);
  }
  return spans;
}

export function resolvePlan(plan: EditPlan, words: WordTiming[], opts: ResolveOptions = {}) {
  const issues: Issue[] = [];
  const idx = new CueIndex(words);
  const dur = plan.narration.durationSec;

  /** Start time of a cue, or an explicit startSec (wins). */
  const at = (where: string, cue: string | undefined, startSec: number | undefined, after = 0, edge: "start" | "end" = "start") => {
    if (startSec !== undefined) return startSec;
    if (!cue) {
      issues.push({ level: "error", where, message: "needs a cue or startSec" });
      return NaN;
    }
    const hits = idx.findAll(cue);
    const hit = hits.find((h) => h.start >= after - 1e-6);
    if (!hit) {
      issues.push({ level: "error", where, message: `cue not found in narration: "${cue}"` });
      return NaN;
    }
    if (hits.length > 1 && after === 0)
      issues.push({ level: "warning", where, message: `cue "${cue}" appears ${hits.length} times; using the first` });
    return edge === "start" ? hit.start : hit.end;
  };

  // Shots run from their cue to the next shot's cue. Search forward so repeated phrases resolve in order.
  let cursor = 0;
  const shotStarts = plan.shots.map((s) => {
    const t = at(`shots.${s.id}`, s.cue, s.startSec, cursor);
    if (Number.isFinite(t)) cursor = t;
    return t;
  });
  shotStarts[0] = 0; // the first shot covers the cold open from frame 0
  for (let i = 1; i < shotStarts.length; i++) {
    if (shotStarts[i] <= shotStarts[i - 1])
      issues.push({ level: "error", where: `shots.${plan.shots[i].id}`, message: "starts before the previous shot" });
  }
  const shots = plan.shots.map((s, i) => {
    if (!s.visual.src)
      issues.push({
        level: opts.allowPlaceholders ? "warning" : "error",
        where: `shots.${s.id}`,
        message: opts.allowPlaceholders ? "no visual source; rendering a placeholder" : "no visual source",
      });
    return {
      id: s.id,
      index: i,
      start: shotStarts[i],
      end: shotStarts[i + 1] ?? dur,
      motion: s.motion,
      shotType: s.shotType,
      src: s.visual.src,
      mediaType: s.visual.type,
      prompt: s.visual.prompt,
    };
  });

  const text = plan.text.map((t, i) => {
    const where = `text[${i}] ${t.type}`;
    const start = at(where, t.cue, t.startSec);
    const end = t.untilEnd ? dur : t.endSec ?? start + (t.durationSec ?? 4);
    const v = checkText(t.text);
    if (v.length)
      issues.push({
        level: v.some((x) => x.severity === "error") ? "error" : "warning",
        where,
        message: `text rules: ${v.map((x) => x.message).join("; ")}`,
        violations: v,
      });
    return { type: t.type, text: t.text, start, end: Math.min(end, dur) };
  });

  // Overlapping text on the same layer.
  const layer = (type: string) =>
    type === "disclosure" ? "lower-left" : type === "lower_third" ? "lower-third" : "center";
  for (let i = 0; i < text.length; i++)
    for (let j = i + 1; j < text.length; j++) {
      const a = text[i], b = text[j];
      if (layer(a.type) === layer(b.type) && a.start < b.end && b.start < a.end)
        issues.push({ level: "error", where: `text[${i}]/text[${j}]`, message: `"${a.text}" overlaps "${b.text}" on the ${layer(a.type)} layer` });
    }

  const music = plan.music.map((m, i) => {
    const where = `music[${i}] ${m.track}`;
    const start = at(where, m.cueStart, m.startSec);
    const end = m.untilEnd ? dur : m.endSec ?? at(where, m.cueEnd, undefined, start);
    const kind = m.track === "show-theme" ? "show-theme" : "bed";
    return {
      track: m.track,
      src: opts.musicSrc?.(m, i) ?? "",
      start,
      end,
      fadeInSec: m.fadeInSec,
      fadeOutSec: m.fadeOutSec,
      levelDb: m.levelDb ?? DEFAULT_LEVEL_DB[kind],
      duckUnderVoiceDb: m.duckUnderVoiceDb,
      generator: m.generator,
    };
  });

  const shorts = plan.shorts.map((s) => {
    const where = `shorts.${s.id}`;
    const start = s.startSec ?? at(where, s.cueStart, undefined);
    const end = s.endSec ?? at(where, s.cueEnd, undefined, start, "end");
    const len = end - start;
    if (Number.isFinite(len) && (len < 15 || len > 60))
      issues.push({ level: "warning", where, message: `length ${len.toFixed(1)}s is outside 15-60s` });
    for (const [field, value] of [["hook", s.hook], ["title", s.title], ["description", s.description]] as const) {
      if (!value) continue;
      const v = checkText(value);
      if (v.some((x) => x.severity === "error"))
        issues.push({ level: "error", where: `${where}.${field}`, message: `text rules: ${v.map((x) => x.message).join("; ")}`, violations: v });
    }
    const { startSec: _s, endSec: _e, ...rest } = s;
    // Absent hook: pick one from the clip (already rule-checked). null: deliberately none.
    const hookAuto = s.hook === undefined;
    const hook = hookAuto ? (Number.isFinite(start) && Number.isFinite(end) ? autoHook(words, start, end) : null) : s.hook;
    return { ...rest, hook, hookAuto, start, end };
  });

  if (plan.shortsDefaults) {
    const v = checkText(plan.shortsDefaults.endCardText);
    if (v.some((x) => x.severity === "error"))
      issues.push({ level: "error", where: "shortsDefaults.endCardText", message: `text rules: ${v.map((x) => x.message).join("; ")}`, violations: v });
  }

  // Captions are narration: report rule hits as warnings (the script is checked upstream in the pipeline).
  const overrides = plan.captions.overrides ?? {};
  const captionText = words.map((w, i) => overrides[i] ?? w.word).join(" ");
  const cv = checkText(captionText);
  if (cv.length)
    issues.push({ level: "warning", where: "captions", message: `text rules: ${cv.map((x) => `${x.message} ("${captionText.slice(Math.max(0, x.start - 25), x.end + 10)}")`).join("; ")}`, violations: cv });

  const resolved: ResolvedPlan = {
    episodeId: plan.episode.id,
    title: plan.episode.title,
    width: plan.output.width,
    height: plan.output.height,
    fps: plan.output.fps,
    durationSec: dur,
    narrationSrc: plan.narration.audio,
    grade: plan.style.grade,
    crossfadeSec: plan.style.crossfadeSec,
    shots,
    text,
    captions: {
      enabled: plan.captions.enabled,
      color: plan.captions.color,
      highlightColor: plan.captions.highlightColor,
      pages: chunkCaptions(words, overrides, { maxLines: plan.captions.maxLines }),
      overrides,
    },
    music,
    voiceSpans: voiceSpans(words),
    shorts,
    shortsDefaults: {
      endCardText: plan.shortsDefaults?.endCardText ?? "Full story on the channel",
      platform: plan.shortsDefaults?.platform ?? "youtube_shorts",
    },
    // Original script words; captions.overrides holds any display fixes.
    words,
  };
  return { resolved, issues };
}
