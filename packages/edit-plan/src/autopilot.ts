import { z } from "zod";
import { checkText } from "@shoebox/text-rules";
import { CueIndex } from "./cues";
import { resolvePlan } from "./resolve";
import { Motion, type EditPlan, type WordTiming } from "./schema";
import { scriptIssues } from "./shows";
import { buildPlanFromScript, type NewEpisodeInput } from "./shows";

/**
 * What a writing run (the scheduled Claude routine) submits for an approved idea.
 * Shots are anchored to exact phrases from the script.
 */
export const Draft = z.object({
  title: z.string().min(1).max(120),
  script: z.string().min(1),
  /** Markdown: the facts used, each with its source URL. Shown on the episode page. */
  factSheet: z.string().min(1),
  /** Video description for the platforms (text rules apply). */
  description: z.string().default(""),
  shots: z
    .array(
      z.object({
        /** 3-8 words copied exactly from the script where this shot should start. */
        cue: z.string().min(1),
        /** Picture description for the image generator (and usable by hand in Midjourney). */
        prompt: z.string().min(1),
        motion: Motion.optional(),
        shotType: z.enum(["wide", "detail"]).optional(),
      }),
    )
    .max(80),
  shorts: z
    .array(z.object({ cueStart: z.string().min(1), cueEnd: z.string().min(1), hook: z.string().optional() }))
    .max(20)
    .default([]),
});
export type Draft = z.infer<typeof Draft>;

/** Problems that should stop a draft before any voice credits are spent. */
export function draftIssues(d: Draft): string[] {
  const out = [...scriptIssues(d.script).errors];
  for (const [field, text] of [["title", d.title], ["description", d.description], ...d.shorts.map((s, i) => [`short ${i + 1} hook`, s.hook ?? ""] as const)] as const) {
    if (!text) continue;
    for (const v of checkText(text)) if (v.severity === "error") out.push(`${field}: ${v.message}`);
  }
  return out;
}

/**
 * The full image prompt for a shot: the writer's description, the show's look,
 * and the show's guardrails (no faces in focus, no readable text, the never-show list).
 */
export function imagePrompt(profile: { visualStyle: string; neverShow: string[] }, shotPrompt: string): string {
  const parts = [shotPrompt.trim().replace(/[.\s]+$/, ""), profile.visualStyle.trim(), "wide 16:9 cinematic frame", "no readable text, no logos, no faces in clear focus"];
  if (profile.neverShow.length) parts.push(`must not show: ${profile.neverShow.join(", ")}`);
  return parts.filter(Boolean).join(". ") + ".";
}

const MIN_SHOT_SEC = 3;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The starter plan, using the writer's shots and shorts where their cue phrases
 * are found in the voiced words. Missing cues are reported and skipped; if too
 * few shots land, the automatic shot layout is used instead.
 */
export function buildPlanFromDraft(i: NewEpisodeInput, draft: Draft): { plan: EditPlan; notes: string[] } {
  const notes: string[] = [];
  const base = buildPlanFromScript(i);
  const cues = new CueIndex(i.words);

  const placed: Array<{ start: number; shot: Draft["shots"][number] }> = [];
  let cursor = 0;
  for (const s of draft.shots) {
    const hit = cues.find(s.cue, cursor);
    if (!hit) {
      notes.push(`shot cue not found in the voiced script: "${s.cue}"`);
      continue;
    }
    const prev = placed[placed.length - 1];
    if (prev && hit.start - prev.start < MIN_SHOT_SEC) {
      notes.push(`shot "${s.cue}" is under ${MIN_SHOT_SEC}s after the previous one; merged`);
      continue;
    }
    placed.push({ start: hit.start, shot: s });
    cursor = hit.start;
  }

  const plan = structuredClone(base);
  if (placed.length >= 3) {
    plan.shots = placed.map((p, n) => ({
      id: `s${String(n + 1).padStart(2, "0")}`,
      ...(n === 0 ? { cue: p.shot.cue } : { startSec: r3(p.start) }),
      approxStartSec: null,
      visual: { type: "image" as const, src: null, prompt: p.shot.prompt },
      motion: p.shot.motion ?? base.shots[n % base.shots.length]?.motion ?? "push_in",
      shotType: p.shot.shotType ?? (n % 2 === 0 ? "wide" : "detail"),
    }));
  } else notes.push(`only ${placed.length} shot cue(s) matched; used the automatic shot layout`);

  const shorts: EditPlan["shorts"] = [];
  draft.shorts.forEach((s, n) => {
    const a = cues.find(s.cueStart);
    const b = a && cues.find(s.cueEnd, a.start);
    if (!a || !b) return notes.push(`short ${n + 1}: cue not found; skipped`);
    shorts.push({ id: `short${shorts.length + 1}`, cueStart: s.cueStart, cueEnd: s.cueEnd, startSec: r3(a.start), endSec: r3(b.end), ...(s.hook ? { hook: s.hook } : {}) });
  });
  if (shorts.length) plan.shorts = shorts;

  const errors = resolvePlan(plan, i.words, { allowPlaceholders: true }).issues.filter((x) => x.level === "error");
  if (errors.length) {
    notes.push(`draft layout did not resolve (${errors[0].message}); used the automatic layout`);
    return { plan: base, notes };
  }
  return { plan, notes };
}
