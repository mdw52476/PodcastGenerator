import { CueIndex } from "./cues";
import { resolvePlan } from "./resolve";
import type { EditPlan, WordTiming } from "./schema";

/**
 * Script editing with selective re-voicing.
 *
 * The narration audio is rebuilt from paragraphs: paragraphs whose text did not
 * change keep their original audio (and the pauses around them) sample-for-sample;
 * new or edited paragraphs use freshly generated speech. Everything here is pure,
 * so it can be tested without calling a voice service.
 */

const squash = (t: string) => t.replace(/\s+/g, " ").trim();

/** Paragraphs of a script: blank lines separate them; line breaks inside become spaces. */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map(squash)
    .filter(Boolean);
}

export const joinParagraphs = (paras: string[]) => paras.join("\n\n") + "\n";

export interface VoicedParagraph {
  text: string;
  /** Word indices (inclusive) and speech times of the paragraph in the current narration. */
  first: number;
  last: number;
  start: number;
  end: number;
}

/** The paragraphs as they are spoken in the current narration (from the word timings). */
export function voicedParagraphs(words: WordTiming[]): VoicedParagraph[] {
  const out: VoicedParagraph[] = [];
  words.forEach((w, i) => {
    if (i === 0 || w.paraStart) out.push({ text: "", first: i, last: i, start: w.start, end: w.end });
    const p = out[out.length - 1];
    p.text = p.text ? `${p.text} ${w.word}` : w.word;
    p.last = i;
    p.end = w.end;
  });
  return out;
}

export type ParagraphOp =
  | { kind: "keep"; oldIndex: number; newIndex: number }
  | { kind: "replace"; oldIndex: number; newIndex: number }
  | { kind: "insert"; newIndex: number }
  | { kind: "delete"; oldIndex: number };

/** Paragraph-level diff (longest common subsequence). Adjacent delete+insert pairs become replacements. */
export function diffParagraphs(oldParas: string[], newParas: string[]): ParagraphOp[] {
  const a = oldParas.map(squash);
  const b = newParas.map(squash);
  const n = a.length;
  const m = b.length;
  const lcs = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);

  const raw: ParagraphOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) raw.push({ kind: "keep", oldIndex: i++, newIndex: j++ });
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) raw.push({ kind: "insert", newIndex: j++ });
    else raw.push({ kind: "delete", oldIndex: i++ });
  }
  // Pair runs of deletes and inserts between keeps into replacements, in order.
  const out: ParagraphOp[] = [];
  for (let k = 0; k < raw.length; ) {
    if (raw[k].kind === "keep") {
      out.push(raw[k++]);
      continue;
    }
    const dels: number[] = [];
    const ins: number[] = [];
    while (k < raw.length && raw[k].kind !== "keep") {
      const op = raw[k++];
      if (op.kind === "delete") dels.push(op.oldIndex);
      else if (op.kind === "insert") ins.push(op.newIndex);
    }
    const pairs = Math.min(dels.length, ins.length);
    for (let p = 0; p < pairs; p++) out.push({ kind: "replace", oldIndex: dels[p], newIndex: ins[p] });
    for (const d of dels.slice(pairs)) out.push({ kind: "delete", oldIndex: d });
    for (const x of ins.slice(pairs)) out.push({ kind: "insert", newIndex: x });
  }
  return out;
}

/** Which paragraphs of the edited script need new speech. */
export function paragraphsToVoice(words: WordTiming[], script: string): { newParas: string[]; ops: ParagraphOp[]; toVoice: number[]; characters: number } {
  const newParas = splitParagraphs(script);
  const ops = diffParagraphs(voicedParagraphs(words).map((p) => p.text), newParas);
  const toVoice = ops.flatMap((o) => (o.kind === "replace" || o.kind === "insert" ? [o.newIndex] : []));
  return { newParas, ops, toVoice, characters: toVoice.reduce((n, k) => n + newParas[k].length, 0) };
}

// ------------------------------------------------------------------ alignment

export interface CharAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * Word timings for `text` from a voice service's character alignment
 * (ElevenLabs "with-timestamps"). Words keep the script's exact spelling.
 */
export function wordsFromAlignment(text: string, al: CharAlignment): WordTiming[] {
  const spoken = al.characters.join("");
  const words: WordTiming[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  let cursor = 0;
  while ((m = re.exec(text))) {
    // The service echoes the text it was sent; find each word from where the last one ended.
    const at = spoken.indexOf(m[0], cursor);
    const s = at >= 0 ? at : Math.min(cursor, spoken.length - 1);
    const e = at >= 0 ? at + m[0].length - 1 : Math.min(s + m[0].length - 1, spoken.length - 1);
    cursor = e + 1;
    words.push({ word: m[0], start: al.character_start_times_seconds[s] ?? 0, end: al.character_end_times_seconds[e] ?? 0 });
  }
  // Keep times monotonic even if the echo drifted.
  for (let k = 1; k < words.length; k++) {
    if (words[k].start < words[k - 1].end) words[k].start = words[k - 1].end;
    if (words[k].end < words[k].start) words[k].end = words[k].start;
  }
  return words;
}

// ------------------------------------------------------------------ assembly

/** One piece of the new narration, in order. Times are seconds. */
export type NarrationSegment =
  | { source: "old"; from: number; to: number }
  | { source: "new"; paragraph: number; from: number; to: number }
  | { source: "silence"; seconds: number };

export interface GeneratedParagraph {
  /** Seconds of generated audio to use (from the first word's start to the last word's end). */
  from: number;
  to: number;
  /** Word timings in the generated file's own time. */
  words: WordTiming[];
}

export interface TimeSpan {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  /** true: audio copied from the old narration (times map linearly). false: replaced. */
  kept: boolean;
}

export interface AssembledNarration {
  segments: NarrationSegment[];
  words: WordTiming[];
  durationSec: number;
  spans: TimeSpan[];
  /** old word index -> new word index, for words in paragraphs that kept their audio. */
  wordIndexMap: Record<number, number>;
}

/**
 * Lay out the new narration. `generated` holds the fresh speech for every
 * paragraph that is not kept (new script paragraph index -> audio range + words).
 */
export function assembleNarration(
  oldWords: WordTiming[],
  oldDurationSec: number,
  newParas: string[],
  ops: ParagraphOp[],
  generated: Map<number, GeneratedParagraph>,
): AssembledNarration {
  const old = voicedParagraphs(oldWords);
  const keptOld = new Map<number, number>(); // new index -> old index (audio reused)
  const replacedOld = new Map<number, number>(); // new index -> old index (text edited)
  for (const o of ops) {
    if (o.kind === "keep") keptOld.set(o.newIndex, o.oldIndex);
    if (o.kind === "replace") replacedOld.set(o.newIndex, o.oldIndex);
  }

  // Default pause between paragraphs: the narration's own median, within reason.
  const gaps = old.slice(1).map((p, i) => p.start - old[i].end).sort((x, y) => x - y);
  const gapDefault = Math.min(1.5, Math.max(0.5, gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0.9));

  const segments: NarrationSegment[] = [];
  const spans: TimeSpan[] = [];
  const words: WordTiming[] = [];
  const wordIndexMap: Record<number, number> = {};
  let t = 0;
  const pushOld = (from: number, to: number) => {
    if (to - from <= 0) return;
    segments.push({ source: "old", from, to });
    spans.push({ oldStart: from, oldEnd: to, newStart: t, newEnd: t + (to - from), kept: true });
    t += to - from;
  };
  const pushSilence = (seconds: number) => {
    segments.push({ source: "silence", seconds });
    t += seconds;
  };

  // Lead-in before the first word.
  const first0 = keptOld.get(0);
  if (first0 === 0) pushOld(0, old[0].start);
  else pushSilence(0.35);

  newParas.forEach((_, k) => {
    const o = keptOld.get(k);
    if (o !== undefined) {
      const p = old[o];
      const shift = t - p.start;
      for (let w = p.first; w <= p.last; w++) {
        wordIndexMap[w] = words.length;
        words.push({ ...oldWords[w], start: oldWords[w].start + shift, end: oldWords[w].end + shift, ...(w === p.first ? { paraStart: true } : {}) });
      }
      pushOld(p.start, p.end);
    } else {
      const g = generated.get(k);
      if (!g) throw new Error(`paragraph ${k + 1} has no generated speech`);
      const shift = t - g.from;
      g.words.forEach((w, i) => words.push({ word: w.word, start: w.start + shift, end: w.end + shift, ...(i === 0 ? { paraStart: true } : {}) }));
      const r = replacedOld.get(k);
      spans.push({ oldStart: r !== undefined ? old[r].start : NaN, oldEnd: r !== undefined ? old[r].end : NaN, newStart: t, newEnd: t + (g.to - g.from), kept: false });
      segments.push({ source: "new", paragraph: k, from: g.from, to: g.to });
      t += g.to - g.from;
    }

    // The pause after this paragraph: the original one if both sides are unchanged neighbours.
    if (k < newParas.length - 1) {
      const next = keptOld.get(k + 1);
      if (o !== undefined && next === o + 1) pushOld(old[o].end, old[o + 1].start);
      else pushSilence(gapDefault);
    }
  });

  // Tail after the last word.
  const lastOld = keptOld.get(newParas.length - 1);
  if (lastOld === old.length - 1) pushOld(old[lastOld].end, oldDurationSec);
  else pushSilence(0.8);

  return { segments, words, durationSec: t, spans, wordIndexMap };
}

/**
 * Map a time on the old narration to the new one. Times in kept audio shift
 * with it; times inside replaced or deleted speech land where that speech now starts.
 */
export function mapTime(spans: TimeSpan[], t: number, newDuration: number): number {
  const kept = spans.filter((s) => s.kept);
  for (const s of kept) if (t >= s.oldStart - 1e-6 && t <= s.oldEnd + 1e-6) return s.newStart + (t - s.oldStart);
  for (const s of spans) if (!s.kept && Number.isFinite(s.oldStart) && t >= s.oldStart && t <= s.oldEnd) return s.newStart;
  const after = kept.filter((s) => s.oldStart > t).sort((x, y) => x.oldStart - y.oldStart)[0];
  return after ? after.newStart : newDuration;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Carry a plan over to the new narration: explicit times shift with the audio,
 * cue phrases that no longer exist become explicit times at their old spot,
 * caption fixes follow their words (fixes on re-voiced words are dropped).
 */
export function remapPlan(plan: EditPlan, oldWords: WordTiming[], assembled: AssembledNarration): { plan: EditPlan; notes: string[] } {
  const notes: string[] = [];
  const next = structuredClone(plan);
  const map = (t: number) => r3(mapTime(assembled.spans, t, assembled.durationSec));
  const oldRes = resolvePlan(plan, oldWords, { allowPlaceholders: true }).resolved;
  const newCues = new CueIndex(assembled.words);
  const cueOk = (cue: string | undefined) => !!cue && newCues.findAll(cue).length > 0;

  next.narration.durationSec = r3(assembled.durationSec);

  next.shots.forEach((s, i) => {
    if (s.startSec !== undefined) s.startSec = map(s.startSec);
    else if (i > 0 && !cueOk(s.cue)) {
      s.startSec = map(oldRes.shots[i].start);
      notes.push(`shot ${s.id}: its cue "${s.cue}" changed; kept the cut at the same moment`);
    }
  });
  next.text.forEach((x, i) => {
    if (x.startSec !== undefined) {
      const len = x.endSec !== undefined ? x.endSec - x.startSec : undefined;
      x.startSec = map(x.startSec);
      if (len !== undefined) x.endSec = r3(x.startSec + len);
    } else if (!cueOk(x.cue)) {
      x.startSec = map(oldRes.text[i].start);
      if (!x.untilEnd && x.durationSec === undefined) x.durationSec = r3(oldRes.text[i].end - oldRes.text[i].start);
      notes.push(`${x.type}: its cue "${x.cue}" changed; kept it at the same moment`);
    }
  });
  next.music.forEach((m, i) => {
    if (m.startSec !== undefined) m.startSec = map(m.startSec);
    else if (!cueOk(m.cueStart)) {
      m.startSec = map(oldRes.music[i].start);
      notes.push(`music ${m.track}: its start cue changed; kept it at the same moment`);
    }
    if (m.untilEnd) return;
    if (m.endSec !== undefined) m.endSec = map(m.endSec);
    else if (!cueOk(m.cueEnd)) {
      m.endSec = map(oldRes.music[i].end);
      notes.push(`music ${m.track}: its end cue changed; kept it at the same moment`);
    }
  });
  next.shorts.forEach((s, i) => {
    const o = oldRes.shorts[i];
    if (s.startSec !== undefined || !cueOk(s.cueStart)) s.startSec = map(s.startSec ?? o.start);
    if (s.endSec !== undefined || !cueOk(s.cueEnd)) s.endSec = map(s.endSec ?? o.end);
  });

  const fixes = plan.captions.overrides ?? {};
  const moved: Record<string, string> = {};
  for (const [k, v] of Object.entries(fixes)) {
    const ni = assembled.wordIndexMap[Number(k)];
    if (ni !== undefined) moved[ni] = v;
    else notes.push(`caption fix "${v}" was on a re-voiced word and was removed`);
  }
  next.captions.overrides = Object.keys(moved).length ? moved : undefined;

  return { plan: next, notes };
}
