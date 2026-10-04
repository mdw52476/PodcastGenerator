import { z } from "zod";

/**
 * Edit plan schema. Bump SCHEMA_VERSION on any change and update
 * fixtures/ep01/edit-plan.json to match.
 *
 * 0.2: narration.wordTimingsFile (sidecar JSON from packages/align),
 *      music[].levelDb, visual.src may be null (placeholder in non-strict renders).
 * 0.3: shorts[] gain startSec/endSec overrides (word-snapped by the UI), platform,
 *      title/description/hashtags, crops as { x } per shot; shortsDefaults.
 * 0.4: shorts[].hook: absent = automatic hook from the clip, null = no hook,
 *      string = custom. (0.3 plans used null for "not set"; they upgrade to absent.)
 */
export const SCHEMA_VERSION = "0.4";

export const WordTiming = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
  paraStart: z.boolean().optional(),
});
export type WordTiming = z.infer<typeof WordTiming>;

/** Anchor: a cue phrase from the script, or an explicit time (which wins). */
const Anchor = {
  cue: z.string().optional(),
  startSec: z.number().nonnegative().optional(),
};

export const Motion = z.enum(["push_in", "pull_out", "drift_left", "drift_right", "pan_up", "static", "static_sway"]);
export type Motion = z.infer<typeof Motion>;

export const Shot = z.object({
  id: z.string(),
  ...Anchor,
  approxStartSec: z.number().nullable().optional(),
  visual: z.object({
    type: z.enum(["image", "video"]),
    src: z.string().nullable(),
    prompt: z.string().optional(),
  }),
  motion: Motion.default("static"),
  shotType: z.string().optional(),
  crop: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type Shot = z.infer<typeof Shot>;

export const TextType = z.enum(["disclosure", "title_card", "episode_title", "lower_third", "end_card"]);
export const TextItem = z.object({
  type: TextType,
  text: z.string(),
  ...Anchor,
  endSec: z.number().optional(),
  durationSec: z.number().positive().optional(),
  untilEnd: z.boolean().optional(),
  position: z.string().optional(),
});
export type TextItem = z.infer<typeof TextItem>;

export const MusicItem = z.object({
  track: z.string().regex(/^(show-theme|bed:[\w-]+)$/),
  generator: z
    .object({
      script: z.string(),
      seed: z.number().int(),
      key: z.string().optional(),
      density: z.enum(["sparse", "normal", "dense"]).optional(),
      brightness: z.number().optional(),
    })
    .optional(),
  cueStart: z.string().optional(),
  startSec: z.number().optional(),
  cueEnd: z.string().optional(),
  endSec: z.number().optional(),
  untilEnd: z.boolean().optional(),
  fadeInSec: z.number().nonnegative().default(2),
  fadeOutSec: z.number().nonnegative().default(2),
  /** Level of the track in the gaps between Walt's lines, dB relative to the bed's peak-normalised file. */
  levelDb: z.number().optional(),
  duckUnderVoiceDb: z.number().max(0).default(-14),
});
export type MusicItem = z.infer<typeof MusicItem>;

export const Platform = z.enum(["youtube_shorts", "tiktok", "reels"]);
export type Platform = z.infer<typeof Platform>;

/**
 * A vertical clip. Cues anchor it to the script; startSec/endSec (written by the
 * clip editor, already snapped to word edges) override the cues.
 */
export const Short = z.object({
  id: z.string(),
  cueStart: z.string(),
  cueEnd: z.string(),
  startSec: z.number().nonnegative().optional(),
  endSec: z.number().positive().optional(),
  /**
   * On-screen line for the first seconds. Must pass the text rules.
   * Absent: an automatic hook is picked from the clip. null: no hook.
   */
  hook: z.string().nullable().optional(),
  /** Horizontal crop centre per shot id, 0 = left edge, 0.5 = centre, 1 = right edge. */
  crops: z.record(z.string(), z.object({ x: z.number().min(0).max(1) })).optional(),
  platform: Platform.optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  hashtags: z.array(z.string()).optional(),
});
export type Short = z.infer<typeof Short>;

export const EditPlan = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  show: z.string(),
  episode: z.object({ id: z.string(), title: z.string(), status: z.string() }),
  output: z.object({
    width: z.number().int(),
    height: z.number().int(),
    fps: z.number().int(),
    loudnessLUFS: z.number(),
    truePeakDb: z.number(),
  }),
  narration: z.object({
    audio: z.string(),
    durationSec: z.number().positive(),
    scriptText: z.string(),
    wordTimings: z.array(WordTiming).nullable().optional(),
    wordTimingsFile: z.string().optional(),
    note: z.string().optional(),
  }),
  style: z.object({
    grade: z.object({
      saturation: z.number(),
      contrast: z.number(),
      tint: z.string(),
      vignette: z.number(),
      grain: z.number(),
      halation: z.number(),
    }),
    crossfadeSec: z.number().nonnegative(),
    fonts: z.record(z.string(), z.string()),
  }),
  shots: z.array(Shot).min(1),
  text: z.array(TextItem),
  captions: z.object({
    enabled: z.boolean(),
    maxLines: z.number().int().min(1).max(3),
    position: z.string(),
    color: z.string(),
    highlightColor: z.string(),
    mode: z.literal("word-highlight"),
    /** Display-text overrides, keyed by word index. Times still come from alignment. */
    overrides: z.record(z.string(), z.string()).optional(),
  }),
  music: z.array(MusicItem),
  sfx: z.array(z.object({ src: z.string(), cue: z.string().optional(), startSec: z.number().optional(), gainDb: z.number().optional() })).optional(),
  shorts: z.array(Short),
  shortsDefaults: z
    .object({
      /** Shown for the last seconds of every short. */
      endCardText: z.string(),
      platform: Platform.default("youtube_shorts"),
    })
    .optional(),
});
export type EditPlan = z.infer<typeof EditPlan>;

/**
 * Bring a stored plan up to SCHEMA_VERSION before parsing. Every version bump
 * so far only added optional fields, so older plans upgrade by relabelling.
 */
export function upgradePlan(raw: any): any {
  if (!raw || typeof raw !== "object") return raw;
  const plan = structuredClone(raw);
  if (plan.schemaVersion === "0.1") {
    if (plan.narration?.wordTimings === null) delete plan.narration.wordTimings;
    plan.schemaVersion = "0.2";
  }
  if (plan.schemaVersion === "0.2") plan.schemaVersion = "0.3";
  if (plan.schemaVersion === "0.3") {
    // In 0.3 a null hook meant "not set"; from 0.4 that is an absent hook (automatic).
    for (const s of plan.shorts ?? []) if (s.hook === null) delete s.hook;
    plan.schemaVersion = "0.4";
  }
  return plan;
}

/** Upgrade, then validate. */
export const parsePlan = (raw: unknown) => EditPlan.safeParse(upgradePlan(raw));
