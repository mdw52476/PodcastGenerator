import { z } from "zod";
import { checkText } from "@shoebox/text-rules";
import { resolvePlan } from "./resolve";
import { SCHEMA_VERSION, type EditPlan, type Motion, type WordTiming } from "./schema";
import { sentencesOf, suggestClips } from "./shorts";
import { splitParagraphs } from "./script";

/** A show's settings: everything an episode inherits. Stored in the `shows` table. */
export const ShowProfile = z.object({
  name: z.string().min(1),
  narrator: z.object({ name: z.string(), identity: z.string().default("") }),
  voice: z.object({
    voiceId: z.string().min(1),
    voiceName: z.string().default(""),
    model: z.string().default("eleven_multilingual_v2"),
    stability: z.number().min(0).max(1).default(0.35),
    similarity: z.number().min(0).max(1).default(0.8),
    style: z.number().min(0).max(1).default(0.2),
    speed: z.number().min(0.7).max(1.2).default(0.88),
  }),
  /** Spoken lines the script writer uses (for reference; the script is what gets voiced). */
  opener: z.string().default(""),
  closer: z.string().default(""),
  disclaimer: z.string().default(""),
  /** On-screen text. All must pass the text rules. */
  titleCard: z.string().min(1),
  disclosureText: z.string().nullable().default("AI narration. Based on real events and public records."),
  look: z.object({
    tint: z.enum(["teal-shadows-amber-highlights", "neutral", "warm", "cool"]).default("teal-shadows-amber-highlights"),
    saturation: z.number().min(0).max(1.5).default(0.7),
    contrast: z.number().min(0.8).max(1.4).default(1.08),
    vignette: z.number().min(0).max(0.6).default(0.25),
    grain: z.number().min(0).max(0.4).default(0.12),
    halation: z.number().min(0).max(0.4).default(0.1),
  }),
  captions: z.object({
    color: z.string().default("#FFFFFF"),
    highlightColor: z.string().default("#E8A33D"),
  }),
  music: z.object({
    preset: z.enum(["dark", "lighter"]).default("dark"),
    seed: z.number().int().default(7),
    duckUnderVoiceDb: z.number().max(0).default(-16),
  }),
  shorts: z.object({
    endCardText: z.string().min(1),
    platform: z.enum(["youtube_shorts", "tiktok", "reels"]).default("youtube_shorts"),
    count: z.number().int().min(0).max(20).default(10),
  }),
  platforms: z.array(z.string()).default(["youtube", "youtube_shorts"]),
  cadence: z.string().default("weekly"),
  targetMinutes: z.number().positive().default(15),
  neverShow: z.array(z.string()).default([]),
  /** Picture style added to every image prompt, e.g. "cinematic 35mm documentary, low-key light". */
  visualStyle: z.string().default(""),
  autopilot: z
    .object({
      /** When on, the scheduled writer proposes ideas for this show and writes approved ones. */
      enabled: z.boolean().default(false),
      ideasPerBatch: z.number().int().min(1).max(10).default(4),
      /** Automatic shot pictures. "none" keeps placeholders. */
      imageModel: z.enum(["flux-schnell", "flux-2-pro", "none"]).default("flux-schnell"),
      /** How many of the episode's suggested shorts render automatically. */
      shortsToRender: z.number().int().min(0).max(20).default(3),
      /** Topic guidance for idea hunting (themes, regions, eras, things to avoid). */
      ideaBrief: z.string().default(""),
    })
    .prefault({}),
});
export type ShowProfile = z.infer<typeof ShowProfile>;

/** Text-rule problems in a profile's on-screen text (errors block saving). */
export function profileTextIssues(p: ShowProfile): string[] {
  const out: string[] = [];
  for (const [field, text] of [
    ["Title card", p.titleCard],
    ["Disclosure", p.disclosureText],
    ["Shorts end card", p.shorts.endCardText],
  ] as const) {
    if (!text) continue;
    for (const v of checkText(text)) if (v.severity === "error") out.push(`${field}: ${v.message}`);
  }
  return out;
}

const MOTIONS: Motion[] = ["push_in", "drift_left", "static", "drift_right", "pull_out", "static_sway"];
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export interface NewEpisodeInput {
  showSlug: string;
  profile: ShowProfile;
  episode: { id: string; title: string };
  script: string;
  words: WordTiming[];
  durationSec: number;
  files: { narration: string; script: string; timings: string };
}

/**
 * A starting edit plan for a freshly voiced script, in the show's style:
 * a shot roughly every 8-15 seconds on sentence starts (placeholder pictures
 * described by the sentence), title, episode title, disclosure and end card,
 * one music bed, and the best-scoring short clips.
 */
export function buildPlanFromScript(i: NewEpisodeInput): EditPlan {
  const { profile: p, words } = i;
  const dur = i.durationSec;
  const sents = sentencesOf(words);

  // Shots: start at paragraph starts, and split long stretches at sentence starts.
  const shots: EditPlan["shots"] = [];
  let lastStart = -Infinity;
  for (const s of sents) {
    const para = !!words[s.first].paraStart;
    const since = s.start - lastStart;
    if (shots.length === 0 || (para && since >= 6) || since >= 12) {
      const n = shots.length;
      shots.push({
        id: `s${String(n + 1).padStart(2, "0")}`,
        ...(n === 0 ? { cue: words.slice(s.first, s.first + 4).map((w) => w.word).join(" ") } : { startSec: r3(s.start) }),
        approxStartSec: null,
        visual: { type: "image", src: null, prompt: s.text.replace(/[.!?]+$/, "") },
        motion: MOTIONS[n % MOTIONS.length],
        shotType: n % 2 === 0 ? "wide" : "detail",
      });
      lastStart = s.start;
    }
  }

  const text: EditPlan["text"] = [];
  if (p.disclosureText) text.push({ type: "disclosure", text: p.disclosureText, startSec: 1, endSec: r3(Math.min(10, dur - 1)), position: "lower-left" });
  text.push({ type: "title_card", text: p.titleCard, startSec: 0.6, durationSec: 3.4 });
  text.push({ type: "episode_title", text: i.episode.title, startSec: 4.4, durationSec: 3.4 });
  text.push({ type: "end_card", text: p.titleCard, startSec: r3(Math.max(8.2, dur - 5)), untilEnd: true });

  const shorts = suggestClips(words, p.shorts.count).map((c, n) => ({
    id: `short${n + 1}`,
    cueStart: words.slice(c.firstWord, Math.min(c.firstWord + 4, c.lastWord + 1)).map((w) => w.word).join(" "),
    cueEnd: words.slice(Math.max(c.firstWord, c.lastWord - 3), c.lastWord + 1).map((w) => w.word).join(" "),
    startSec: r3(c.start),
    endSec: r3(c.end),
  }));

  const plan: EditPlan = {
    schemaVersion: SCHEMA_VERSION,
    show: i.showSlug,
    episode: { id: i.episode.id, title: i.episode.title, status: "edited" },
    output: { width: 1920, height: 1080, fps: 30, loudnessLUFS: -14, truePeakDb: -1.5 },
    narration: { audio: i.files.narration, durationSec: r3(dur), scriptText: i.files.script, wordTimingsFile: i.files.timings },
    style: {
      grade: { saturation: p.look.saturation, contrast: p.look.contrast, tint: p.look.tint, vignette: p.look.vignette, grain: p.look.grain, halation: p.look.halation },
      crossfadeSec: 0.5,
      fonts: { title: "Oswald (OFL)", captions: "Inter (OFL)" },
    },
    shots,
    text,
    captions: { enabled: true, maxLines: 2, position: "bottom-center", color: p.captions.color, highlightColor: p.captions.highlightColor, mode: "word-highlight" },
    music: [
      {
        track: `bed:${p.music.preset}`,
        generator: { script: "ambient_bed.py", seed: p.music.seed },
        startSec: 0,
        untilEnd: true,
        fadeInSec: 2,
        fadeOutSec: 3,
        duckUnderVoiceDb: p.music.duckUnderVoiceDb,
      },
    ],
    shorts,
    shortsDefaults: { endCardText: p.shorts.endCardText, platform: p.shorts.platform },
  };

  const errors = resolvePlan(plan, words, { allowPlaceholders: true }).issues.filter((x) => x.level === "error");
  if (errors.length) throw new Error(`starter plan did not resolve: ${errors.map((e) => `${e.where}: ${e.message}`).join("; ")}`);
  return plan;
}

/** Script checks before spending voice credits: text rules and the per-request size limit. */
export function scriptIssues(script: string): { errors: string[]; warnings: string[]; characters: number } {
  const errors: string[] = [];
  const warnings: string[] = [];
  splitParagraphs(script).forEach((para, k) => {
    if (para.length > 2500) errors.push(`Paragraph ${k + 1} is ${para.length} characters; split it (2,500 max per voice request).`);
    for (const v of checkText(para)) (v.severity === "error" ? errors : warnings).push(`Paragraph ${k + 1}: ${v.message} (“${para.slice(Math.max(0, v.start - 20), v.end + 15)}”)`);
  });
  return { errors, warnings, characters: splitParagraphs(script).join("").length };
}
