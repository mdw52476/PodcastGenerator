import React from "react";
import { Composition } from "remotion";
import { resolveShort, type ResolvedPlan, type ShortProps } from "@shoebox/edit-plan";
import { Episode, type EpisodeProps } from "./Episode";
import { Short } from "./Short";

// Minimal stand-in so Remotion Studio opens without props; real plans arrive via --props.
const EMPTY: ResolvedPlan = {
  episodeId: "empty",
  title: "",
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: 5,
  narrationSrc: "",
  grade: { saturation: 0.7, contrast: 1.08, tint: "teal-shadows-amber-highlights", vignette: 0.25, grain: 0.12, halation: 0.1 },
  crossfadeSec: 0.5,
  shots: [{ id: "s01", index: 0, start: 0, end: 5, motion: "push_in", src: null, mediaType: "image", shotType: "wide", prompt: "empty plan" }],
  text: [],
  captions: { enabled: false, color: "#fff", highlightColor: "#E8A33D", pages: [] },
  music: [],
  voiceSpans: [],
  shorts: [{ id: "empty", cueStart: "", cueEnd: "", start: 0, end: 5, hook: null }],
  shortsDefaults: { endCardText: "", platform: "youtube_shorts" },
  words: [],
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="Episode"
      component={Episode}
      defaultProps={{ plan: EMPTY, placeholderLabels: true } satisfies EpisodeProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.ceil(props.plan.durationSec * props.plan.fps),
        fps: props.plan.fps,
        width: props.plan.width,
        height: props.plan.height,
      })}
    />
    <Composition
      id="Short"
      component={Short}
      defaultProps={resolveShort(EMPTY, "empty") satisfies ShortProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.ceil(props.durationSec * props.plan.fps),
        fps: props.plan.fps,
        width: props.preset.width,
        height: props.preset.height,
      })}
    />
  </>
);
