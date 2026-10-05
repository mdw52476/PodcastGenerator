import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlanFromDraft, Draft, draftIssues, EditPlan, resolvePlan, ShowProfile, type WordTiming } from "./index";

const root = join(__dirname, "../../../fixtures");
const shoebox = ShowProfile.parse(JSON.parse(readFileSync(join(root, "shows/the-shoebox-files.json"), "utf8")));
const ep01 = EditPlan.parse(JSON.parse(readFileSync(join(root, "ep01/edit-plan.json"), "utf8")));
const words: WordTiming[] = JSON.parse(readFileSync(join(root, "ep01/word-timings.json"), "utf8")).words;
const script = readFileSync(join(root, "ep01/ep01-voiceover-v2.txt"), "utf8");

// EP01's own shot list, as if the writer had submitted it.
const draft = Draft.parse({
  title: "The Name in the Water",
  script,
  factSheet: "- Glen Burbage identified July 2026 (NJ State Police).",
  shots: [...ep01.shots.map((s) => ({ cue: s.cue!, prompt: s.visual.prompt!, motion: s.motion })), { cue: "words that are nowhere in the script", prompt: "x" }],
  shorts: ep01.shorts.map((s) => ({ cueStart: s.cueStart, cueEnd: s.cueEnd })),
});
const input = {
  showSlug: "the-shoebox-files",
  profile: shoebox,
  episode: { id: "test", title: draft.title },
  script,
  words,
  durationSec: 403.33,
  files: { narration: "n.mp3", script: "s.txt", timings: "w.json" },
};

describe("drafts from the writer", () => {
  it("parse with defaults and pass the text rules", () => {
    expect(draftIssues(draft)).toEqual([]);
    expect(draft.description).toBe("");
  });

  it("catch rule-breaking titles before voicing", () => {
    expect(draftIssues({ ...draft, title: "He was not there — really" }).length).toBe(2);
  });

  it("use the writer's shots and prompts where cues are found, and report the rest", () => {
    const { plan, notes } = buildPlanFromDraft(input, draft);
    expect(plan.shots.length).toBeGreaterThanOrEqual(25);
    expect(plan.shots[0].visual.prompt).toBe(ep01.shots[0].visual.prompt);
    expect(notes.some((n) => n.includes("nowhere in the script"))).toBe(true);
    expect(resolvePlan(plan, words, { allowPlaceholders: true }).issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("place the writer's shorts on the voiced words", () => {
    const { plan } = buildPlanFromDraft(input, draft);
    expect(plan.shorts.length).toBe(5);
    expect(plan.shorts[0].startSec).toBe(words[0].start);
  });

  it("fall back to the automatic layout when too few cues match", () => {
    const { plan, notes } = buildPlanFromDraft(input, { ...draft, shots: [{ cue: "nope nope", prompt: "x" }] });
    expect(plan.shots.length).toBeGreaterThan(20);
    expect(notes.some((n) => n.includes("automatic shot layout"))).toBe(true);
  });
});
