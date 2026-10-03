import type { WordTiming } from "./schema";

export interface CaptionWord {
  index: number;
  text: string;
  start: number;
  end: number;
}
export interface CaptionPage {
  start: number;
  end: number;
  lines: CaptionWord[][];
}

export interface ChunkOptions {
  maxLines: number;
  maxCharsPerLine: number;
  /** A silence longer than this starts a new page. */
  pauseSec: number;
  /** How long a page may linger after its last word if nothing follows. */
  holdSec: number;
}

const DEFAULTS: ChunkOptions = { maxLines: 2, maxCharsPerLine: 38, pauseSec: 0.7, holdSec: 0.6 };

const endsSentence = (w: string) => /[.!?]["”’')]*$/.test(w);
const endsClause = (w: string) => /[,;:]["”’')]*$/.test(w);
const isCapitalised = (w: string) => /^["“(]?[A-Z]/.test(w);

/**
 * Group words into units that must stay on one line. Consecutive capitalised
 * words with no punctuation between them form a name ("Glen Napoleon Burbage",
 * "New Jersey State Police"), so a name is never split across lines or pages.
 */
function units(words: CaptionWord[]): CaptionWord[][] {
  const out: CaptionWord[][] = [];
  for (const w of words) {
    const cur = out[out.length - 1];
    const prev = cur?.[cur.length - 1];
    if (prev && isCapitalised(prev.text) && isCapitalised(w.text) && !/[.,;:!?]$/.test(prev.text)) {
      cur.push(w);
    } else {
      out.push([w]);
    }
  }
  return out;
}

const unitLen = (u: CaptionWord[]) => u.reduce((n, w) => n + w.text.length, 0) + u.length - 1;

/**
 * Split units into about `n` parts of similar length, each at most `maxLen`
 * chars (a single oversize unit, i.e. a long name, gets a part to itself).
 * Prefers to break after a comma once a part is well along.
 */
function balance(us: CaptionWord[][], n: number, maxLen: number): CaptionWord[][][] {
  const total = us.reduce((s, u) => s + unitLen(u), 0) + us.length - 1;
  const target = total / Math.max(1, n);
  const parts: CaptionWord[][][] = [[]];
  let cur = 0;
  us.forEach((u, k) => {
    const part = parts[parts.length - 1];
    if (part.length) {
      const next = cur + 1 + unitLen(u);
      const lastWord = part[part.length - 1].at(-1)!;
      const remaining = us.slice(k).reduce((s, x) => s + unitLen(x) + 1, -1);
      const canSplit = parts.length < n && remaining > 6;
      const pastTarget = next - target > target - cur;
      const clause = endsClause(lastWord.text) && cur >= target * 0.6;
      if (next > maxLen || (canSplit && (pastTarget || clause))) {
        parts.push([]);
        cur = 0;
      }
    }
    const p = parts[parts.length - 1];
    cur += (p.length ? 1 : 0) + unitLen(u);
    p.push(u);
  });
  return parts;
}

export function chunkCaptions(
  timings: WordTiming[],
  overrides: Record<string, string> = {},
  opts: Partial<ChunkOptions> = {},
): CaptionPage[] {
  const o = { ...DEFAULTS, ...opts };
  const words: CaptionWord[] = timings.map((t, i) => ({ index: i, text: overrides[i] ?? t.word, start: t.start, end: t.end }));

  // 1. Segments: runs of units between hard breaks (sentence end, paragraph, long pause).
  const segments: CaptionWord[][][] = [];
  let prev: CaptionWord | undefined;
  for (const u of units(words)) {
    const first = u[0];
    const hardBreak =
      !prev || endsSentence(prev.text) || timings[first.index].paraStart || first.start - prev.end > o.pauseSec;
    if (hardBreak) segments.push([]);
    segments[segments.length - 1].push(u);
    prev = u[u.length - 1];
  }

  // 2. Balance each segment across pages, then each page across lines,
  //    so a sentence never strands one word on a page of its own.
  const seqLen = (us: CaptionWord[][]) => us.reduce((n, u) => n + unitLen(u), 0) + us.length - 1;
  const pages: CaptionWord[][][] = [];
  for (const seg of segments) {
    // Word boundaries can make a page need an extra line; add pages until every page fits.
    for (let nPages = Math.ceil(Math.ceil(seqLen(seg) / o.maxCharsPerLine) / o.maxLines); ; nPages++) {
      const laid = balance(seg, nPages, o.maxCharsPerLine * o.maxLines).map((pageUnits) => {
        const nLines = Math.min(o.maxLines, Math.ceil(seqLen(pageUnits) / o.maxCharsPerLine));
        return balance(pageUnits, nLines, o.maxCharsPerLine).map((us) => us.flat());
      });
      if (laid.every((p) => p.length <= o.maxLines) || nPages >= seg.length) {
        pages.push(...laid);
        break;
      }
    }
  }

  return pages.map((ls, i) => {
    const start = ls[0][0].start;
    const lastWord = ls[ls.length - 1].at(-1)!;
    const next = pages[i + 1]?.[0][0].start ?? Infinity;
    return { start, end: Math.min(next, lastWord.end + o.holdSec), lines: ls };
  });
}
