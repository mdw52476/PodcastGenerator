// pnpm autopilot <command>  (used by the scheduled writer; see autopilot/ROUTINE.md)
//
//   context                                  shows with autopilot on, recent episodes, waiting ideas
//   submit-ideas --show <id> --file ideas.json
//   claim                                    take the oldest approved idea (prints it, or "none")
//   check --file draft.json                  validate a draft (text rules, cues, sizes)
//   submit --episode <id> --file draft.json  check, then submit; queues voicing
//
// Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and STUDIO_AUTOPILOT_TOKEN. The token can only
// call the autopilot functions; it cannot read or change anything else in the studio.
import { readFileSync } from "node:fs";
import { CueIndex, Draft, draftIssues, splitParagraphs } from "@shoebox/edit-plan";
import { parseArgs } from "@shoebox/engine/pipeline";
import { optional } from "./env";

const [command, ...rest] = process.argv.slice(2).filter((a) => a !== "--");
const args = parseArgs(rest);

function need(name: string): string {
  const v = optional(name);
  if (!v) {
    console.error(`Missing ${name}. Set it in the routine's environment variables.`);
    process.exit(2);
  }
  return v;
}

async function rpc(fn: string, body: Record<string, unknown>) {
  const res = await fetch(`${need("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: need("SUPABASE_PUBLISHABLE_KEY"), "content-type": "application/json" },
    body: JSON.stringify({ p_token: need("STUDIO_AUTOPILOT_TOKEN"), ...body }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).message ?? text;
    } catch {}
    throw new Error(`${fn} failed (HTTP ${res.status}): ${msg}`);
  }
  return text ? JSON.parse(text) : null;
}

const readJson = (file: unknown) => {
  if (typeof file !== "string") throw new Error("pass --file <path to json>");
  return JSON.parse(readFileSync(file, "utf8"));
};

/** Everything that would make a draft fail later, found now. */
function checkDraft(raw: unknown): { draft: Draft | null; problems: string[]; warnings: string[] } {
  const parsed = Draft.safeParse(raw);
  if (!parsed.success) return { draft: null, problems: parsed.error.issues.map((i) => `${i.path.join(".") || "draft"}: ${i.message}`), warnings: [] };
  const d = parsed.data;
  const problems = draftIssues(d);
  const warnings: string[] = [];

  // Cues must be exact phrases from the script (case and punctuation don't matter).
  const words = d.script.split(/\s+/).filter(Boolean).map((w, i) => ({ word: w, start: i, end: i }));
  const cues = new CueIndex(words);
  let cursor = 0;
  d.shots.forEach((s, i) => {
    const hit = cues.find(s.cue, cursor);
    if (!hit) problems.push(`shots[${i}].cue "${s.cue}" is not an exact phrase from the script (or is out of order)`);
    else cursor = hit.start;
  });
  d.shorts.forEach((s, i) => {
    const a = cues.find(s.cueStart);
    if (!a) problems.push(`shorts[${i}].cueStart "${s.cueStart}" is not in the script`);
    else if (!cues.find(s.cueEnd, a.start)) problems.push(`shorts[${i}].cueEnd "${s.cueEnd}" is not in the script after its start`);
  });

  const paras = splitParagraphs(d.script);
  const wordCount = words.length;
  if (paras.length < 3) warnings.push(`only ${paras.length} paragraph(s); separate paragraphs with blank lines`);
  if (d.shots.length < Math.max(3, Math.floor(wordCount / 60))) warnings.push(`${d.shots.length} shots for ${wordCount} words; aim for one every 25-35 words`);
  if (!/https?:\/\//.test(d.factSheet)) problems.push("factSheet has no source links");
  return { draft: d, problems, warnings };
}

try {
  if (command === "context") {
    const ctx = await rpc("autopilot_context", {});
    console.log(JSON.stringify(ctx, null, 2));
  } else if (command === "submit-ideas") {
    if (typeof args.show !== "string") throw new Error("pass --show <show id>");
    const ideas = readJson(args.file);
    const ids = await rpc("autopilot_submit_ideas", { p_show: args.show, p_ideas: ideas });
    console.log(`Pitched ${ids.length} idea(s): ${ids.join(", ")}`);
  } else if (command === "claim") {
    const ep = await rpc("autopilot_claim", {});
    console.log(ep ? JSON.stringify(ep, null, 2) : "none");
  } else if (command === "check") {
    const { problems, warnings } = checkDraft(readJson(args.file));
    for (const w of warnings) console.log(`warning: ${w}`);
    for (const p of problems) console.log(`PROBLEM: ${p}`);
    console.log(problems.length ? `\n${problems.length} problem(s). Fix them, then check again.` : "\nDraft is ready to submit.");
    process.exitCode = problems.length ? 1 : 0;
  } else if (command === "submit") {
    if (typeof args.episode !== "string") throw new Error("pass --episode <episode id>");
    const raw = readJson(args.file);
    const { draft, problems } = checkDraft(raw);
    if (!draft || problems.length) {
      for (const p of problems) console.log(`PROBLEM: ${p}`);
      throw new Error("not submitted; run `pnpm autopilot check` and fix the problems first");
    }
    const r = await rpc("autopilot_submit_draft", { p_episode: args.episode, p_draft: draft });
    console.log(`Submitted ${r.episode}. Voicing is queued (job ${r.voiceJob}); images and renders follow automatically.`);
  } else {
    console.log("usage: pnpm autopilot <context | submit-ideas --show <id> --file f | claim | check --file f | submit --episode <id> --file f>");
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
