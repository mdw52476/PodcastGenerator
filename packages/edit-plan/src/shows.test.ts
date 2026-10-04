import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlanFromScript, EditPlan, profileTextIssues, resolvePlan, scriptIssues, ShowProfile, type WordTiming } from "./index";

const root = join(__dirname, "../../../fixtures");
const shoebox = ShowProfile.parse(JSON.parse(readFileSync(join(root, "shows/the-shoebox-files.json"), "utf8")));
const testShow = ShowProfile.parse(JSON.parse(readFileSync(join(root, "shows/studio-test.json"), "utf8")));
const words: WordTiming[] = JSON.parse(readFileSync(join(root, "ep01/word-timings.json"), "utf8")).words;
const ep01Script = readFileSync(join(root, "ep01/ep01-voiceover-v2.txt"), "utf8");

describe("show profiles", () => {
  it("both shows' on-screen text passes the text rules", () => {
    expect(profileTextIssues(shoebox)).toEqual([]);
    expect(profileTextIssues(testShow)).toEqual([]);
  });

  it("the Shoebox profile matches the voice and look EP01 was made with", () => {
    expect(shoebox.voice).toMatchObject({ voiceId: "pqHfZKP75CvOlQylNhV4", speed: 0.88, stability: 0.35 });
    expect(shoebox.captions.highlightColor).toBe("#E8A33D");
  });

  it("flags rule-breaking on-screen text", () => {
    const bad = { ...testShow, titleCard: "NOT A TITLE — REALLY" };
    expect(profileTextIssues(bad).length).toBe(2);
  });
});

describe("scripts", () => {
  it("the EP01 script and the test-show script are ready to voice", () => {
    expect(scriptIssues(ep01Script).errors).toEqual([]);
    const t = scriptIssues(readFileSync(join(root, "shows/studio-test-ep01.txt"), "utf8"));
    expect(t.errors).toEqual([]);
    expect(t.characters).toBeLessThan(700); // keeps the free-tier test cheap
  });

  it("blocks scripts that break the text rules before any credits are spent", () => {
    expect(scriptIssues("He did not stop.\n\nFine.").errors.length).toBe(1);
  });
});

describe("starter plan", () => {
  const plan = buildPlanFromScript({
    showSlug: "studio-test",
    profile: testShow,
    episode: { id: "test-ep01", title: "The Keeper's Log" },
    script: ep01Script,
    words,
    durationSec: 403.33,
    files: { narration: "narration.mp3", script: "script.txt", timings: "word-timings.json" },
  });

  it("is a valid plan that resolves with no errors", () => {
    expect(EditPlan.safeParse(plan).success).toBe(true);
    expect(resolvePlan(plan, words, { allowPlaceholders: true }).issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("uses the show's look, captions, music and end card", () => {
    expect(plan.style.grade.tint).toBe("cool");
    expect(plan.captions.highlightColor).toBe("#5FA8A8");
    expect(plan.music[0].track).toBe("bed:lighter");
    expect(plan.shortsDefaults?.endCardText).toBe("More on the Studio Test Show");
    expect(plan.text.find((t) => t.type === "title_card")?.text).toBe("STUDIO TEST SHOW");
  });

  it("cuts roughly every 6-15 seconds on sentence starts", () => {
    const r = resolvePlan(plan, words, { allowPlaceholders: true }).resolved;
    const lens = r.shots.map((s) => s.end - s.start);
    expect(r.shots.length).toBeGreaterThan(20);
    expect(Math.max(...lens.slice(0, -1))).toBeLessThan(30);
    const starts = new Set(words.map((w) => w.start));
    for (const s of r.shots.slice(1)) expect(starts.has(s.start)).toBe(true);
  });

  it("suggests up to the show's number of shorts", () => {
    expect(plan.shorts.length).toBeGreaterThan(0);
    expect(plan.shorts.length).toBeLessThanOrEqual(3);
  });
});
