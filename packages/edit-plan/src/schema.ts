import { z } from "zod";

/**
 * Edit plan schema. Bump SCHEMA_VERSION on any change and update
 * fixtures/ep01/edit-plan.json to match.
 *
 * 0.2: narration.wordTimingsFile (sidecar JSON from packages/align),
 *      music[].levelDb, visual.src may be null (placeholder in non-strict renders).
 */
export const SCHEMA_VERSION = "0.2";

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
  shorts: z.array(
    z.object({
      id: z.string(),
      cueStart: z.string(),
      cueEnd: z.string(),
      hook: z.string().nullable().optional(),
      crops: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
    }),
  ),
});
export type EditPlan = z.infer<typeof EditPlan>;
