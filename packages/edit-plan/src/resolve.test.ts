import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkCaptions, EditPlan, musicGain, resolvePlan, type WordTiming } from "./index";

const dir = join(__dirname, "../../../fixtures/ep01");
const plan = EditPlan.parse(JSON.parse(readFileSync(join(dir, "edit-plan.json"), "utf8")));
const words: WordTiming[] = JSON.parse(readFileSync(join(dir, "word-timings.json"), "utf8")).words;
const { resolved, issues } = resolvePlan(plan, words, { allowPlaceholders: true });

describe("EP01 fixture", () => {
  it("resolves every cue with no errors", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("orders 27 shots that tile the whole narration", () => {
    expect(resolved.shots).toHaveLength(27);
    expect(resolved.shots[0].start).toBe(0);
    for (let i = 1; i < 27; i++) expect(resolved.shots[i].start).toBe(resolved.shots[i - 1].end);
    expect(resolved.shots.at(-1)!.end).toBe(plan.narration.durationSec);
  });

  it("lands shots near the script's scene markers", () => {
    const t = (id: string) => resolved.shots.find((s) => s.id === id)!.start;
    expect(t("s04")).toBeGreaterThan(30); // opener ~00:38
    expect(t("s04")).toBeLessThan(45);
    expect(t("s15")).toBeGreaterThan(190); // Sydney ~03:15+
  });

  it("spells Glen with one n in captions", () => {
    const text = resolved.captions.pages.flatMap((p) => p.lines.flat().map((w) => w.text)).join(" ");
    expect(text).toContain("Glen Napoleon Burbage.");
    expect(text).not.toMatch(/Glenn/);
  });

  it("resolves all five shorts", () => {
    expect(resolved.shorts.map((s) => Number.isFinite(s.start) && s.end > s.start)).toEqual([true, true, true, true, true]);
  });
});

describe("captions", () => {
  const pages = resolved.captions.pages;
  it("never exceeds two lines of ~38 chars (names excepted)", () => {
    for (const p of pages) {
      expect(p.lines.length).toBeLessThanOrEqual(2);
      for (const l of p.lines) {
        const s = l.map((w) => w.text).join(" ");
        // Only a line holding a long name may run over, and it must be just the name (plus at most one word).
        if (s.length > 38) expect(l.length, s).toBeLessThanOrEqual(8);
        if (s.length > 38) expect(/^(\S+ )?([A-Z]\S* ?)+$/.test(s), s).toBe(true);
      }
    }
  });
  it("never splits a name across lines or pages", () => {
    const lines = pages.flatMap((p) => p.lines.map((l) => l.map((w) => w.text).join(" ")));
    expect(lines.some((l) => l.includes("Glen Napoleon Burbage"))).toBe(true);
    for (const l of lines) expect(l).not.toMatch(/(^|\s)Napoleon$/);
    expect(lines.filter((l) => /\bNew$/.test(l))).toEqual([]);
  });
  it("uses overrides for display text", () => {
    const p = chunkCaptions([{ word: "Glenn", start: 0, end: 1 }], { 0: "Glen" });
    expect(p[0].lines[0][0].text).toBe("Glen");
  });
});

describe("music gain", () => {
  const bed = resolved.music[1];
  it("ducks under voice and opens in gaps", () => {
    const span = resolved.voiceSpans.find((s) => s[0] > bed.start + 5 && s[1] - s[0] > 2)!;
    const under = musicGain(bed, resolved.voiceSpans, (span[0] + span[1]) / 2);
    const open = Math.pow(10, bed.levelDb / 20);
    expect(20 * Math.log10(under / open)).toBeCloseTo(bed.duckUnderVoiceDb, 1);
  });
  it("is silent outside the track", () => {
    expect(musicGain(bed, resolved.voiceSpans, bed.start - 1)).toBe(0);
    expect(musicGain(bed, resolved.voiceSpans, bed.end + bed.fadeOutSec + 0.1)).toBe(0);
  });
});
