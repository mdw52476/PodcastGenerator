import React from "react";
import { AbsoluteFill, Html5Audio, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { musicGain, type ResolvedPlan } from "@shoebox/edit-plan";
import "./fonts";
import { Captions } from "./Captions";
import { GradeFilter, GradeOverlay } from "./Grade";
import { Shot } from "./Shot";
import { TextCards } from "./TextCards";

export interface EpisodeProps extends Record<string, unknown> {
  plan: ResolvedPlan;
  /** Show shot id + prompt on placeholder frames (review renders). */
  placeholderLabels?: boolean;
}

/** Fade up from black at the top, down to black at the end. */
const Bookends: React.FC<{ durationSec: number }> = ({ durationSec }) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const o = interpolate(t, [0, 1.2, durationSec - 2.5, durationSec], [1, 0, 0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ backgroundColor: "black", opacity: o }} />;
};

export const Episode: React.FC<EpisodeProps> = ({ plan, placeholderLabels = true }) => {
  const { fps } = useVideoConfig();
  const f = (sec: number) => Math.round(sec * fps);
  const xf = plan.crossfadeSec;

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <GradeFilter id="grade" grade={plan.grade} />

      {/* Picture: graded as one layer so every shot shares the look. */}
      <AbsoluteFill style={{ filter: "url(#grade)" }}>
        {plan.shots.map((s, i) => {
          const from = Math.max(0, f(s.start - (i === 0 ? 0 : xf / 2)));
          const to = f(Math.min(plan.durationSec, s.end + xf / 2));
          return (
            <Sequence key={s.id} from={from} durationInFrames={Math.max(1, to - from)} layout="none">
              <AbsoluteFill>
                <Shot shot={s} durationInFrames={to - from} fadeInFrames={i === 0 ? 0 : f(xf)} placeholderLabels={placeholderLabels} />
              </AbsoluteFill>
            </Sequence>
          );
        })}
      </AbsoluteFill>

      <GradeOverlay grade={plan.grade} />
      <TextCards text={plan.text} />
      <Captions captions={plan.captions} />
      <Bookends durationSec={plan.durationSec} />

      {/* Audio: narration at unity; music beds faded and ducked under Walt's voice. */}
      <Html5Audio src={staticFile(plan.narrationSrc)} />
      {plan.music.map((m, i) => {
        const from = f(m.start);
        const to = f(Math.min(plan.durationSec, m.end + m.fadeOutSec));
        return (
          <Sequence key={i} from={from} durationInFrames={Math.max(1, to - from)} layout="none">
            <Html5Audio src={staticFile(m.src)} volume={(fr) => musicGain(m, plan.voiceSpans, (from + fr) / fps)} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
