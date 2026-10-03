import type { WordTiming } from "./schema";

/** Lowercase, straighten apostrophes, drop punctuation. "1981," -> "1981", "It's" -> "it's". */
export function normWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']/g, "")
    .replace(/^'+|'+$/g, "");
}

/** Split a cue phrase into normalised tokens, splitting hyphens the same way the script does (it keeps them). */
export function cueTokens(cue: string): string[] {
  return cue.split(/\s+/).map(normWord).filter(Boolean);
}

export interface CueHit {
  /** Index of the first and last script word of the phrase. */
  first: number;
  last: number;
  /** Start of the first word / end of the last word, seconds. */
  start: number;
  end: number;
}

export class CueIndex {
  private norm: string[];
  constructor(private words: WordTiming[]) {
    this.norm = words.map((w) => normWord(w.word));
  }

  /** Every occurrence of the phrase. */
  findAll(cue: string): CueHit[] {
    const toks = cueTokens(cue);
    if (!toks.length) return [];
    const hits: CueHit[] = [];
    outer: for (let i = 0; i + toks.length <= this.norm.length; i++) {
      for (let k = 0; k < toks.length; k++) if (this.norm[i + k] !== toks[k]) continue outer;
      const last = i + toks.length - 1;
      hits.push({ first: i, last, start: this.words[i].start, end: this.words[last].end });
    }
    return hits;
  }

  /** First occurrence at or after `afterSec` (lets ordered lists like shots disambiguate repeats). */
  find(cue: string, afterSec = 0): CueHit | undefined {
    return this.findAll(cue).find((h) => h.start >= afterSec - 1e-6);
  }
}
