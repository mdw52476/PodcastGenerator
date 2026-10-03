// pnpm align --plan fixtures/ep01/edit-plan.json
// Writes the plan's narration.wordTimingsFile from its narration audio + script text.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { EditPlan } from "@shoebox/edit-plan";
import { alignNarration, parseArgs } from "./lib";

const args = parseArgs(process.argv.slice(2));
if (typeof args.plan !== "string") {
  console.error("usage: pnpm align --plan <edit-plan.json>");
  process.exit(1);
}
const planPath = resolve(args.plan);
const plan = EditPlan.parse(JSON.parse(readFileSync(planPath, "utf8")));
const dir = dirname(planPath);
const out = resolve(dir, plan.narration.wordTimingsFile ?? "word-timings.json");
await alignNarration(resolve(dir, plan.narration.audio), resolve(dir, plan.narration.scriptText), out);
console.log(`wrote ${out}`);
