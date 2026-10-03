import { describe, expect, it } from "vitest";
import { checkText, hasErrors } from "./index";

const rules = (t: string) => checkText(t).map((v) => v.rule);

describe("no-not", () => {
  it("flags bare not", () => {
    expect(rules("He was not there.")).toEqual(["no-not"]);
  });
  it("flags n't contractions, straight and curly apostrophes", () => {
    const v = checkText("He didn't call. She won’t wait.");
    expect(v.map((x) => x.match)).toEqual(["didn't", "won’t"]);
  });
  it("reports exact positions", () => {
    const [v] = checkText("It was not him.");
    expect([v.start, v.end]).toEqual([7, 10]);
  });
  it("exempts quoted dialogue", () => {
    expect(checkText('He said, "I do not know." Then he left.')).toEqual([]);
    expect(checkText("She said, “Don't go.”")).toEqual([]);
  });
  it("still flags narration next to dialogue", () => {
    expect(rules('"Wait," he said. He did not wait.')).toEqual(["no-not"]);
  });
  it("leaves words that merely contain 'not' alone", () => {
    expect(checkText("Nothing in the notebook. A knot.")).toEqual([]);
  });
});

describe("one-and", () => {
  it("allows one and", () => {
    expect(checkText("Salt and pepper.")).toEqual([]);
  });
  it("flags every and after the first", () => {
    const v = checkText("Rain and wind and fog and cold.");
    expect(v.map((x) => x.start)).toEqual([14, 22]);
  });
  it("counts per sentence", () => {
    expect(checkText("Salt and pepper. Bread and butter.")).toEqual([]);
  });
  it("is case-insensitive and ignores words like 'sand'", () => {
    expect(rules("And the sand and the sea.")).toEqual(["one-and"]);
    expect(checkText("Sand, band, Andrew and land.")).toEqual([]);
  });
});

describe("no-em-dash", () => {
  it("flags em dashes but allows hyphens and en dashes", () => {
    expect(rules("The box — the old one.")).toEqual(["no-em-dash"]);
    expect(checkText("Forty-five years, 1981–2026.")).toEqual([]);
  });
});

describe("ai-tells", () => {
  it("warns without making the text an error", () => {
    const v = checkText("A rich tapestry of clues.");
    expect(v[0]).toMatchObject({ rule: "ai-tell", severity: "warning", match: "tapestry" });
    expect(hasErrors(v)).toBe(false);
  });
});

describe("fixture strings", () => {
  it("passes the EP01 on-screen text", () => {
    for (const t of [
      "AI narration. Based on real events and public records.",
      "THE SHOEBOX FILES",
      "The Name in the Water",
      "NJ State Police Missing Persons Unit · missingpinformation@njsp.gov",
    ]) {
      expect(hasErrors(checkText(t))).toBe(false);
    }
  });
});
