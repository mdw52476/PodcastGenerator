import { checkText } from "@shoebox/text-rules";
import { chunkCaptions, type CaptionPage } from "./captions";
import type { ResolvedPlan } from "./resolve";
import type { Platform, WordTiming } from "./schema";

// ------------------------------------------------------------------ platforms

export interface PlatformPreset {
  id: Platform;
  label: string;
  width: number;
  height: number;
  minSec: number;
  maxSec: number;
  /** UI overlays to keep text out of, as fractions of the frame. */
  safe: { top: number; bottom: number; left: number; right: number };
}

export const PLATFORMS: Record<Platform, PlatformPreset> = {
  youtube_shorts: { id: "youtube_shorts", label: "YouTube Shorts", width: 1080, height: 1920, minSec: 15, maxSec: 60, safe: { top: 0.1, bottom: 0.22, left: 0.06, right: 0.14 } },
  tiktok: { id: "tiktok", label: "TikTok", width: 1080, height: 1920, minSec: 15, maxSec: 60, safe: { top: 0.09, bottom: 0.25, left: 0.06, right: 0.16 } },
  reels: { id: "reels", label: "Instagram Reels", width: 1080, height: 1920, minSec: 15, maxSec: 90, safe: { top: 0.12, bottom: 0.22, left: 0.06, right: 0.14 } },
};

// ------------------------------------------------------------------ resolving

export const SHORT_END_CARD_SEC = 2.5;
/** Breathing room so the first word isn't clipped and the last word can land. */
export const SHORT_PRE_ROLL = 0.12;
export const SHORT_POST_ROLL = 0.45;

export interface ShortProps extends Record<string, unknown> {
  plan: ResolvedPlan;
  short: {
    id: string;
    /** Clip window on the episode timeline, seconds (already padded). */
    start: number;
    end: number;
    hook: string | null;
    crops: Record<string, { x: number }>;
  };
  preset: PlatformPreset;
  captions: CaptionPage[];
  endCardText: string;
  durationSec: number;
  placeholderLabels: boolean;
}

/** Everything the vertical composition needs for one short. Pure, so the browser preview and the worker agree. */
export function resolveShort(plan: ResolvedPlan, shortId: string, opts: { placeholderLabels?: boolean } = {}): ShortProps {
  const s = plan.shorts.find((x) => x.id === shortId);
  if (!s) throw new Error(`no short "${shortId}" in plan`);
  const start = Math.max(0, s.start - SHORT_PRE_ROLL);
  const end = Math.min(plan.durationSec, s.end + SHORT_POST_ROLL);
  const preset = PLATFORMS[s.platform ?? plan.shortsDefaults.platform];
  const inRange = plan.words.filter((w) => w.start >= start - 0.01 && w.end <= end + 0.01);
  // Narrow frame: fewer characters per line; bigger type.
  const captions = chunkCaptions(inRange, {}, { maxLines: 2, maxCharsPerLine: 22, pauseSec: 0.6 });
  return {
    plan,
    short: { id: s.id, start, end, hook: s.hook ?? null, crops: s.crops ?? {} },
    preset,
    captions,
    endCardText: plan.shortsDefaults.endCardText,
    durationSec: end - start + SHORT_END_CARD_SEC,
    placeholderLabels: opts.placeholderLabels ?? true,
  };
}

/** Nearest word edge: starts for an in-point, ends for an out-point. */
export function snapToWord(words: WordTiming[], t: number, edge: "start" | "end"): number {
  let best = edge === "start" ? words[0].start : words[words.length - 1].end;
  for (const w of words) {
    const v = edge === "start" ? w.start : w.end;
    if (Math.abs(v - t) < Math.abs(best - t)) best = v;
  }
  return best;
}

// ------------------------------------------------------------------ suggestions

export interface Sentence {
  first: number;
  last: number;
  start: number;
  end: number;
  text: string;
  /** Silence after this sentence, seconds. */
  gapAfter: number;
  paraBreakAfter: boolean;
  /** Starts a paragraph, or follows a long pause. */
  freshStart: boolean;
}

export function sentencesOf(words: WordTiming[]): Sentence[] {
  const out: Sentence[] = [];
  let first = 0;
  words.forEach((w, i) => {
    const endsHere = /[.!?]["”’')]*$/.test(w.word) || i === words.length - 1;
    if (!endsHere) return;
    const next = words[i + 1];
    out.push({
      first,
      last: i,
      start: words[first].start,
      end: w.end,
      text: words.slice(first, i + 1).map((x) => x.word).join(" "),
      gapAfter: next ? next.start - w.end : 99,
      paraBreakAfter: !next || !!next.paraStart,
      freshStart: first === 0 || !!words[first].paraStart || words[first].start - words[first - 1].end >= 0.6,
    });
    first = i + 1;
  });
  return out;
}

const DEPENDENT_START = new Set(["and", "but", "so", "then", "he", "she", "it", "they", "that", "this", "those", "these", "his", "her", "him", "its", "their", "there", "also", "still", "meanwhile"]);
const STRONG = /\b(nobody|never|missing|disappeared|dead|name|DNA|match|years|water|body|file|secret|why|how|what)\b/i;
const firstWord = (t: string) => t.split(/\s+/)[0].toLowerCase().replace(/[^a-z']/g, "");

export interface ClipScore {
  total: number;
  standsAlone: number;
  hook: number;
  endsOnBeat: number;
  length: number;
  notes: string[];
}

/** Score a clip made of sentences [a..b]. */
export function scoreClip(sents: Sentence[], a: number, b: number): ClipScore {
  const notes: string[] = [];
  const open = sents[a];
  const close = sents[b];
  const dur = close.end - open.start;

  // "This is The Shoebox Files" style openers are fine; "He'd carry..." needs context.
  const fw = firstWord(open.text);
  // "He'd", "They're", "That's" lean on earlier lines; "It's April of 2026" does not.
  const dependent =
    (DEPENDENT_START.has(fw) || ["he", "she", "they", "we"].includes(fw.split("'")[0]) || fw === "that's") && !/^this is\b/i.test(open.text);
  let standsAlone = 1;
  if (dependent) {
    standsAlone = 0.3;
    notes.push(`opens with "${fw}", which needs earlier context`);
  } else if (!open.freshStart) {
    standsAlone = 0.8;
    notes.push("starts mid-paragraph");
  }

  const firstSec = open.end - open.start;
  const firstWords = open.last - open.first + 1;
  let hook = 0.3;
  if (firstSec <= 4) hook += 0.2;
  if (STRONG.test(open.text) || /\d/.test(open.text) || open.text.trim().endsWith("?")) hook += 0.3;
  if (firstWords > 22) hook -= 0.2;
  hook = Math.min(1, Math.max(0, hook + 0.2));
  if (hook < 0.7) notes.push("first line is slow to hook");

  let endsOnBeat = 0.3;
  if (close.paraBreakAfter) endsOnBeat += 0.35;
  if (close.gapAfter >= 0.6) endsOnBeat += 0.2;
  if (close.last - close.first + 1 <= 8) endsOnBeat += 0.15;
  endsOnBeat = Math.min(1, endsOnBeat);
  if (endsOnBeat < 0.7) notes.push("ending runs straight into the next line");

  const length = dur < 15 ? 0 : dur > 60 ? 0 : dur >= 25 && dur <= 45 ? 1 : dur < 25 ? (dur - 15) / 10 : (60 - dur) / 15;
  if (dur < 20) notes.push("on the short side");
  if (dur > 50) notes.push("on the long side");

  const total = 0.35 * standsAlone + 0.3 * hook + 0.25 * endsOnBeat + 0.1 * length;
  return { total: Math.round(total * 100) / 100, standsAlone, hook, endsOnBeat, length, notes };
}

/** A short sentence from inside the clip that could sit on screen as the hook, if it passes the text rules. */
export function suggestHook(sents: Sentence[], a: number, b: number): string | null {
  const candidates = sents
    .slice(a, b + 1)
    .filter((s) => s.last - s.first + 1 <= 9 && s.last - s.first + 1 >= 3)
    .sort((x, y) => Number(STRONG.test(y.text)) - Number(STRONG.test(x.text)) || x.text.length - y.text.length);
  for (const c of candidates) {
    const text = c.text.replace(/[.!]+$/, "");
    if (!checkText(text).some((v) => v.severity === "error")) return text;
  }
  return null;
}

export interface ClipSuggestion {
  start: number;
  end: number;
  firstWord: number;
  lastWord: number;
  text: string;
  score: ClipScore;
  hook: string | null;
}

/** Best non-overlapping 20-50 s windows that start and end on sentence edges. */
export function suggestClips(words: WordTiming[], count = 8): ClipSuggestion[] {
  const sents = sentencesOf(words);
  const all: ClipSuggestion[] = [];
  for (let a = 0; a < sents.length; a++) {
    for (let b = a; b < sents.length; b++) {
      const dur = sents[b].end - sents[a].start;
      if (dur > 50) break;
      if (dur < 20) continue;
      const score = scoreClip(sents, a, b);
      all.push({
        start: sents[a].start,
        end: sents[b].end,
        firstWord: sents[a].first,
        lastWord: sents[b].last,
        text: sents.slice(a, b + 1).map((s) => s.text).join(" "),
        score,
        hook: suggestHook(sents, a, b),
      });
    }
  }
  all.sort((x, y) => y.score.total - x.score.total);
  const picked: ClipSuggestion[] = [];
  for (const c of all) {
    const overlaps = picked.some((p) => Math.min(p.end, c.end) - Math.max(p.start, c.start) > 0.3 * (c.end - c.start));
    if (!overlaps) picked.push(c);
    if (picked.length >= count) break;
  }
  return picked.sort((x, y) => x.start - y.start);
}

/** Score an arbitrary window (e.g. a planned short) by the sentences it covers. */
export function scoreWindow(words: WordTiming[], start: number, end: number): ClipScore | null {
  const sents = sentencesOf(words);
  const a = sents.findIndex((s) => s.end > start + 0.05);
  let b = -1;
  sents.forEach((s, i) => {
    if (s.start < end - 0.05) b = i;
  });
  return a >= 0 && b >= a ? scoreClip(sents, a, b) : null;
}
