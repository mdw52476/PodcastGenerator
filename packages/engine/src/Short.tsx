import React from "react";
import { AbsoluteFill, Html5Audio, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { musicGain, SHORT_END_CARD_SEC, type ShortProps } from "@shoebox/edit-plan";
import { asset } from "./assets";
import { Captions } from "./Captions";
import { TITLE_FONT } from "./fonts";
import { GradeFilter, GradeOverlay } from "./Grade";
import { Shot } from "./Shot";

const AMBER = "#E8A33D";

/** A 16:9 shot shown in a 9:16 frame: full height, cropped horizontally around `x` (0 left .. 1 right). */
const VerticalCrop: React.FC<{ x: number; children: React.ReactNode }> = ({ x, children }) => {
  const { width, height } = useVideoConfig();
  const innerW = (height * 16) / 9;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 0, height, width: innerW, left: -(innerW - width) * x }}>{children}</div>
    </AbsoluteFill>
  );
};

const Hook: React.FC<{ text: string; top: number; left: number; right: number }> = ({ text, top, left, right }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const o = interpolate(t, [0, 0.35, 2.5, 2.9], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lift = interpolate(t, [0, 0.6], [16, 0], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top, left, right, opacity: o, transform: `translateY(${lift}px)`, textAlign: "center" }}>
      <div
        style={{
          fontFamily: TITLE_FONT,
          fontWeight: 600,
          fontSize: 78,
          lineHeight: 1.12,
          color: "#F6F1EA",
          textWrap: "balance",
          textShadow: "0 4px 24px rgba(0,0,0,0.85)",
        }}
      >
        {text}
      </div>
      <div style={{ margin: "22px auto 0", width: 120, height: 4, backgroundColor: AMBER }} />
    </div>
  );
};

const EndCard: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const o = interpolate(frame / fps, [0, 0.5], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.62)" }} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 110px" }}>
        <div style={{ fontFamily: TITLE_FONT, fontWeight: 600, fontSize: 84, lineHeight: 1.1, color: "#F6F1EA", textAlign: "center", textWrap: "balance", textShadow: "0 4px 24px rgba(0,0,0,0.7)" }}>
          {text}
        </div>
        <div style={{ marginTop: 26, width: 140, height: 4, backgroundColor: AMBER }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Fade up at the top, down to black over the last half second. */
const Bookends: React.FC<{ durationSec: number }> = ({ durationSec }) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  const o = interpolate(t, [0, 0.25, durationSec - 0.5, durationSec], [1, 0, 0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ backgroundColor: "black", opacity: o }} />;
};

/**
 * Vertical short cut from the episode. Everything inside the shifted Sequence
 * runs on episode time, so shots, captions, music and ducking line up exactly
 * with the long-form render.
 */
export const Short: React.FC<ShortProps> = ({ plan, short, preset, captions, endCardText, durationSec, placeholderLabels }) => {
  const { fps, width, height } = useVideoConfig();
  const f = (sec: number) => Math.round(sec * fps);
  const startF = f(short.start);
  const clipF = f(short.end - short.start);
  const endF = f(SHORT_END_CARD_SEC);
  const xf = plan.crossfadeSec;
  const safe = {
    top: preset.safe.top * height,
    bottom: preset.safe.bottom * height,
    left: preset.safe.left * width,
    right: preset.safe.right * width,
  };

  // Gentle edges so the clip doesn't start or stop mid-syllable.
  const edge = (epFrame: number) => {
    const t = epFrame / fps;
    return Math.min(1, Math.max(0, (t - short.start) / 0.12), Math.max(0, (short.end - t) / 0.3));
  };
  const musicTail = (epFrame: number) => {
    const t = epFrame / fps;
    const fadeIn = Math.min(1, Math.max(0, (t - short.start) / 0.4));
    const fadeOut = t <= short.end ? 1 : Math.max(0, 1 - (t - short.end) / SHORT_END_CARD_SEC);
    return fadeIn * fadeOut;
  };
  const shots = plan.shots.filter((s) => s.end > short.start && s.start < short.end + SHORT_END_CARD_SEC);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <GradeFilter id="grade-v" grade={plan.grade} />

      {/* Picture on episode time, through the end card (dimmed there). */}
      <AbsoluteFill style={{ filter: "url(#grade-v)" }}>
        <Sequence from={-startF} durationInFrames={startF + clipF + endF} layout="none">
          {shots.map((s) => {
            const from = Math.max(0, f(s.start - (s.index === 0 ? 0 : xf / 2)));
            const to = f(Math.min(plan.durationSec, s.end + xf / 2));
            return (
              <Sequence key={s.id} from={from} durationInFrames={Math.max(1, to - from)} layout="none">
                <VerticalCrop x={short.crops[s.id]?.x ?? 0.5}>
                  <Shot shot={s} durationInFrames={to - from} fadeInFrames={s.index === 0 ? 0 : f(xf)} placeholderLabels={placeholderLabels} />
                </VerticalCrop>
              </Sequence>
            );
          })}
        </Sequence>
      </AbsoluteFill>

      <GradeOverlay grade={plan.grade} />

      {/* Captions on episode time, clip only. Lower-middle of the frame, inside the platform's safe area. */}
      <Sequence from={-startF} durationInFrames={startF + clipF} layout="none">
        <Captions captions={plan.captions} pages={captions} layout={{ top: height * 0.6, left: safe.left, right: safe.right, fontSize: 66 }} />
      </Sequence>

      {short.hook && (
        <Sequence durationInFrames={f(3)} layout="none">
          <Hook text={short.hook} top={safe.top + 60} left={safe.left + 20} right={safe.right + 20} />
        </Sequence>
      )}

      <Sequence from={clipF} durationInFrames={endF} layout="none">
        <EndCard text={endCardText} />
      </Sequence>

      <Bookends durationSec={durationSec} />

      {/* Audio. Media can't sit in a sequence that starts before frame 0 (it is
          dropped from the render), so each track starts at its place in the clip
          and uses trimBefore to skip what came earlier in the episode. */}
      <Sequence durationInFrames={clipF} layout="none">
        <Html5Audio src={asset(plan.narrationSrc)} trimBefore={startF} volume={(fr) => edge(startF + fr)} />
      </Sequence>
      {plan.music.map((m, i) => {
        const mFrom = f(m.start);
        const mTo = f(Math.min(plan.durationSec, m.end + m.fadeOutSec));
        const from = Math.max(mFrom, startF);
        const to = Math.min(mTo, startF + clipF + endF);
        if (to <= from || from >= startF + clipF) return null;
        const trim = from - mFrom; // frames into the music file
        return (
          <Sequence key={i} from={from - startF} durationInFrames={to - from} layout="none">
            <Html5Audio
              src={asset(m.src)}
              trimBefore={trim > 0 ? trim : undefined}
              volume={(fr) => musicGain(m, plan.voiceSpans, (from + fr) / fps) * musicTail(from + fr)}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

