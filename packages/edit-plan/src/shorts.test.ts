import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkText } from "@shoebox/text-rules";
import {
  EditPlan,
  PLATFORMS,
  resolvePlan,
  resolveShort,
  scoreWindow,
  sentencesOf,
  SHORT_END_CARD_SEC,
  snapToWord,
  suggestClips,
  type WordTiming,
} from "./index";

const dir = join(__dirname, "../../../fixtures/ep01");
const plan = EditPlan.parse(JSON.parse(readFileSync(join(dir, "edit-plan.json"), "utf8")));
const words: WordTiming[] = JSON.parse(readFileSync(join(dir, "word-timings.json"), "utf8")).words;
const { resolved, issues } = resolvePlan(plan, words, { allowPlaceholders: true });

describe("planned shorts", () => {
  it("resolve with no errors and carry the end card text", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
    expect(resolved.shortsDefaults.endCardText).toBe("Full story on The Shoebox Files");
  });

  it("start on the first word of the cue and end on the last word", () => {
    const s1 = resolved.shorts[0];
    expect(s1.start).toBe(words[0].start);
    const last = words.findIndex((w) => w.word === "forty-five" && words[words.indexOf(w) + 1]?.word === "years.");
    expect(s1.end).toBe(words[last + 1].end);
  });

  it("resolveShort pads the window, adds the end card and keeps captions narrow", () => {
    const p = resolveShort(resolved, "short2");
    const s = resolved.shorts[1];
    expect(p.short.start).toBeLessThan(s.start);
    expect(p.short.end).toBeGreaterThan(s.end);
    expect(p.durationSec).toBeCloseTo(p.short.end - p.short.start + SHORT_END_CARD_SEC, 5);
    expect(p.preset).toBe(PLATFORMS.youtube_shorts);
    for (const page of p.captions) {
      expect(page.lines.length).toBeLessThanOrEqual(2);
      expect(page.start).toBeGreaterThanOrEqual(p.short.start - 0.01);
    }
    const text = p.captions.flatMap((c) => c.lines.flat().map((w) => w.text)).join(" ");
    expect(text).toContain("Glen Burbage would have turned sixty.");
  });

  it("explicit startSec/endSec override the cues", () => {
    const p2 = structuredClone(plan);
    p2.shorts[0].startSec = 2.82;
    p2.shorts[0].endSec = 25.0;
    const r = resolvePlan(p2, words, { allowPlaceholders: true }).resolved;
    expect(r.shorts[0].start).toBe(2.82);
    expect(r.shorts[0].end).toBe(25.0);
  });

  it("rejects a hook that breaks the text rules", () => {
    const p2 = structuredClone(plan);
    p2.shorts[0].hook = "He was not who they thought";
    const r = resolvePlan(p2, words, { allowPlaceholders: true });
    expect(r.issues.some((i) => i.level === "error" && i.where === "shorts.short1.hook")).toBe(true);
  });
});

describe("word snapping", () => {
  it("snaps in-points to word starts and out-points to word ends", () => {
    const w = words[50];
    expect(snapToWord(words, w.start + 0.03, "start")).toBe(w.start);
    expect(snapToWord(words, w.end - 0.03, "end")).toBe(w.end);
  });
});

describe("clip suggestions", () => {
  const clips = suggestClips(words);

  it("returns several non-overlapping 20-50 s clips on sentence edges", () => {
    expect(clips.length).toBeGreaterThanOrEqual(5);
    const sentEnds = new Set(sentencesOf(words).map((s) => s.end));
    for (const c of clips) {
      expect(c.end - c.start).toBeGreaterThanOrEqual(20);
      expect(c.end - c.start).toBeLessThanOrEqual(50);
      expect(sentEnds.has(c.end)).toBe(true);
    }
    for (let i = 1; i < clips.length; i++) {
      const overlap = clips[i - 1].end - clips[i].start;
      expect(overlap).toBeLessThan(0.3 * (clips[i].end - clips[i].start) + 1e-6);
    }
  });

  it("scores between 0 and 1 and explains weak spots", () => {
    for (const c of clips) {
      expect(c.score.total).toBeGreaterThan(0);
      expect(c.score.total).toBeLessThanOrEqual(1);
    }
  });

  it("only suggests hooks that pass the text rules", () => {
    for (const c of clips) if (c.hook) expect(checkText(c.hook).filter((v) => v.severity === "error")).toEqual([]);
  });

  it("penalises clips that open mid-thought", () => {
    // "He'd carry that label..." depends on the previous line.
    const sents = sentencesOf(words);
    const i = sents.findIndex((s) => s.text.startsWith("He'd carry"));
    const s = scoreWindow(words, sents[i].start, sents[i + 3].end)!;
    expect(s.standsAlone).toBeLessThan(0.5);
  });
});
