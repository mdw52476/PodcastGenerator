import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assembleNarration,
  diffParagraphs,
  EditPlan,
  mapTime,
  paragraphsToVoice,
  remapPlan,
  resolvePlan,
  splitParagraphs,
  voicedParagraphs,
  wordsFromAlignment,
  type GeneratedParagraph,
  type WordTiming,
} from "./index";

const dir = join(__dirname, "../../../fixtures/ep01");
const plan = EditPlan.parse(JSON.parse(readFileSync(join(dir, "edit-plan.json"), "utf8")));
const words: WordTiming[] = JSON.parse(readFileSync(join(dir, "word-timings.json"), "utf8")).words;
const script = readFileSync(join(dir, "ep01-voiceover-v2.txt"), "utf8");
const paras = splitParagraphs(script);
const old = voicedParagraphs(words);

/** Fake "generated speech" for a paragraph: 0.33 s per word, 0.1 s lead-in. */
function fakeSpeech(text: string): GeneratedParagraph {
  const ws = text.split(/\s+/).map((w, i) => ({ word: w, start: 0.1 + i * 0.33, end: 0.1 + i * 0.33 + 0.28 }));
  return { from: ws[0].start, to: ws[ws.length - 1].end, words: ws };
}
function revoice(newParas: string[]) {
  const ops = diffParagraphs(old.map((p) => p.text), newParas);
  const gen = new Map<number, GeneratedParagraph>();
  for (const o of ops) if (o.kind === "replace" || o.kind === "insert") gen.set(o.newIndex, fakeSpeech(newParas[o.newIndex]));
  return { ops, a: assembleNarration(words, plan.narration.durationSec, newParas, ops, gen) };
}

describe("paragraphs", () => {
  it("the script file and the voiced narration agree, paragraph for paragraph", () => {
    expect(old.map((p) => p.text)).toEqual(paras);
  });

  it("an unchanged script needs no re-voicing", () => {
    const r = paragraphsToVoice(words, script);
    expect(r.toVoice).toEqual([]);
    expect(r.characters).toBe(0);
  });

  it("finds edits, insertions and deletions", () => {
    const edited = [...paras];
    edited[4] = "This is The Shoebox Files. I'm Walt Harlan. Pull up a chair.";
    edited.splice(8, 0, "A brand new paragraph goes here.");
    edited.splice(12, 1);
    const ops = diffParagraphs(paras, edited);
    expect(ops.filter((o) => o.kind === "replace")).toEqual([{ kind: "replace", oldIndex: 4, newIndex: 4 }]);
    expect(ops.filter((o) => o.kind === "insert")).toEqual([{ kind: "insert", newIndex: 8 }]);
    expect(ops.filter((o) => o.kind === "delete")).toEqual([{ kind: "delete", oldIndex: 11 }]);
    const r = paragraphsToVoice(words, edited.join("\n\n"));
    expect(r.toVoice).toEqual([4, 8]);
    expect(r.characters).toBe(edited[4].length + edited[8].length);
  });

  it("ignores whitespace-only changes", () => {
    const messy = paras.map((p) => p.replace(/ /g, "  ")).join("\n\n\n");
    expect(paragraphsToVoice(words, messy).toVoice).toEqual([]);
  });
});

describe("alignment to words", () => {
  it("maps character times onto the script's words", () => {
    const text = "Glen got on a plane.";
    const chars = text.split("");
    const al = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.1), character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.09) };
    const w = wordsFromAlignment(text, al);
    expect(w.map((x) => x.word)).toEqual(["Glen", "got", "on", "a", "plane."]);
    expect(w[0]).toMatchObject({ start: 0, end: 0.39 });
    expect(w[4].start).toBeCloseTo(1.4, 5);
  });
});

describe("assembling the new narration", () => {
  const k = 11; // "Two months went by. ..." paragraph
  const edited = [...paras];
  edited[k] = "Two months passed. Then a boat crew spotted something in the water.";
  const { a } = revoice(edited);
  const oldP = old[k];
  const newWordsOfK = edited[k].split(/\s+/).length;

  it("keeps every word before the edit exactly where it was", () => {
    for (let w = 0; w < old[k - 1].last + 1; w++) expect(a.words[w]).toEqual(words[w]);
  });

  it("uses the generated words for the edited paragraph, script spelling intact", () => {
    const start = old[k - 1].last + 1;
    expect(a.words.slice(start, start + newWordsOfK).map((w) => w.word).join(" ")).toBe(edited[k]);
    expect(a.words[start].paraStart).toBe(true);
  });

  it("shifts everything after the edit by one constant amount", () => {
    const after = oldP.last + 1;
    const newAfter = old[k - 1].last + 1 + newWordsOfK;
    const delta = a.words[newAfter].start - words[after].start;
    for (let w = after; w < words.length; w++) {
      expect(a.words[newAfter + (w - after)].word).toBe(words[w].word);
      expect(a.words[newAfter + (w - after)].start - words[w].start).toBeCloseTo(delta, 6);
    }
    expect(a.durationSec).toBeCloseTo(plan.narration.durationSec + delta, 6);
  });

  it("maps times: before unchanged, after shifted, inside the edit to its new start", () => {
    expect(mapTime(a.spans, 30, a.durationSec)).toBeCloseTo(30, 6);
    const after = words[oldP.last + 5].start;
    const delta = a.durationSec - plan.narration.durationSec;
    expect(mapTime(a.spans, after, a.durationSec)).toBeCloseTo(after + delta, 6);
    const inside = (oldP.start + oldP.end) / 2;
    const newStart = a.words[old[k - 1].last + 1].start;
    expect(mapTime(a.spans, inside, a.durationSec)).toBeCloseTo(newStart, 6);
  });

  it("covers the whole new duration with segments", () => {
    const total = a.segments.reduce((n, s) => n + (s.source === "silence" ? s.seconds : s.to - s.from), 0);
    expect(total).toBeCloseTo(a.durationSec, 6);
  });
});

describe("carrying the plan over", () => {
  const k = 11; // holds the cue "Two months went by" for shot s11
  const edited = [...paras];
  edited[k] = "Two months passed. Then a boat crew spotted something in the water.";
  const { a } = revoice(edited);

  it("keeps the plan renderable and pins a lost cue at its old moment", () => {
    expect(paras[k].startsWith("Two months went by.")).toBe(true);
    const p = structuredClone(plan);
    p.shots[20].startSec = 300; // an explicit cut after the edit
    const glen = words.findIndex((w) => w.word === "Glen");
    const inEdit = old[k].first + 1;
    p.captions.overrides = { [glen]: "GLEN", [inEdit]: "x" };
    const { plan: next, notes } = remapPlan(p, words, a);
    const delta = a.durationSec - plan.narration.durationSec;

    expect(next.shots[10].startSec).toBeDefined(); // s11's cue no longer exists
    expect(next.shots[20].startSec).toBeCloseTo(300 + delta, 2);
    expect(next.captions.overrides).toEqual({ [glen]: "GLEN" }); // before the edit: same index
    expect(notes.some((n) => n.includes("s11"))).toBe(true);
    expect(notes.some((n) => n.includes("re-voiced word"))).toBe(true);

    const { issues } = resolvePlan(next, a.words, { allowPlaceholders: true });
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });
});
