/**
 * Prime-directive checker for audience-facing text.
 *
 *  1. No "not" or "n't" contractions outside quoted dialogue.
 *  2. At most one "and" per sentence.
 *  3. No em dashes.
 * Plus a warning-level pass for ai-tells vocabulary.
 *
 * Positions are character offsets into the input string, so the UI can
 * highlight them and the pipeline can report them.
 */

export type RuleId = "no-not" | "one-and" | "no-em-dash" | "ai-tell";

export interface Violation {
  rule: RuleId;
  severity: "error" | "warning";
  start: number;
  end: number;
  match: string;
  message: string;
}

export const AI_TELLS = [
  "delve", "delves", "delving", "tapestry", "leverage", "leveraging", "robust",
  "multifaceted", "navigate", "navigating", "foster", "fostering", "testament",
  "journey", "landscape", "realm", "intricate", "pivotal", "unwavering",
  "embark", "unravel", "unveil", "meticulous", "seamless", "showcase",
  "underscore", "underscores", "vibrant", "beacon", "symphony", "nestled",
];

const QUOTE_PAIRS: Array<[string, string]> = [
  ['"', '"'],
  ["“", "”"],
];

/** Character ranges [start, end) that sit inside double-quoted dialogue. */
export function dialogueRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    const pair = QUOTE_PAIRS.find(([open]) => text[i] === open);
    if (pair) {
      const close = text.indexOf(pair[1], i + 1);
      if (close === -1) break; // unbalanced: treat the rest as narration
      ranges.push([i, close + 1]);
      i = close + 1;
    } else {
      i++;
    }
  }
  return ranges;
}

/** Sentence spans [start, end). Splits on . ! ? followed by whitespace or end. */
export function sentences(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = /[^.!?]+(?:[.!?]+["”’']?|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[0].trim()) out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

const inside = (pos: number, ranges: Array<[number, number]>) =>
  ranges.some(([s, e]) => pos >= s && pos < e);

export function checkText(text: string): Violation[] {
  const v: Violation[] = [];
  const dialogue = dialogueRanges(text);

  // 1. not / n't outside dialogue
  for (const m of text.matchAll(/\b(not|\w+n['’]t)\b/gi)) {
    if (inside(m.index!, dialogue)) continue;
    v.push({
      rule: "no-not",
      severity: "error",
      start: m.index!,
      end: m.index! + m[0].length,
      match: m[0],
      message: `"${m[0]}" outside quoted dialogue`,
    });
  }

  // 2. max one "and" per sentence
  for (const [s, e] of sentences(text)) {
    const ands = [...text.slice(s, e).matchAll(/\band\b/gi)];
    for (const m of ands.slice(1)) {
      v.push({
        rule: "one-and",
        severity: "error",
        start: s + m.index!,
        end: s + m.index! + 3,
        match: m[0],
        message: `sentence has ${ands.length} "and"s (max 1)`,
      });
    }
  }

  // 3. em dashes
  for (const m of text.matchAll(/—/g)) {
    v.push({ rule: "no-em-dash", severity: "error", start: m.index!, end: m.index! + 1, match: m[0], message: "em dash" });
  }

  // ai-tells vocabulary
  const tells = new RegExp(`\\b(${AI_TELLS.join("|")})\\b`, "gi");
  for (const m of text.matchAll(tells)) {
    v.push({
      rule: "ai-tell",
      severity: "warning",
      start: m.index!,
      end: m.index! + m[0].length,
      match: m[0],
      message: `ai-tells word "${m[0]}"`,
    });
  }

  return v.sort((a, b) => a.start - b.start);
}

export const hasErrors = (v: Violation[]) => v.some((x) => x.severity === "error");
