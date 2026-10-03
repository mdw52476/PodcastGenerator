// Debug helper: print caption pages for a word-timings file.
// Usage: tsx scripts/dump-captions.ts ../../fixtures/ep01/word-timings.json
import { readFileSync } from "node:fs";
import { chunkCaptions } from "@shoebox/edit-plan";

const words = JSON.parse(readFileSync(process.argv[2], "utf8")).words;
for (const p of chunkCaptions(words)) {
  console.log(p.start.toFixed(1).padStart(6), p.lines.map((l) => l.map((x) => x.text).join(" ")).join("  |  "));
}
