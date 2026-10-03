import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { ResolvedPlan } from "@shoebox/edit-plan";
import { BODY_FONT, TITLE_FONT } from "./fonts";

const AMBER = "#E8A33D";
type Card = ResolvedPlan["text"][number];

/** Gentle fade in and out; `fadeOut` 0 holds to the end (end card). */
const useFade = (c: Card, fadeIn: number, fadeOut: number) => {
  const t = useCurrentFrame() / useVideoConfig().fps;
  if (t < c.start || t > c.end) return 0;
  const a = interpolate(t, [c.start, c.start + fadeIn], [0, 1], { extrapolateRight: "clamp" });
  const b = fadeOut > 0 ? interpolate(t, [c.end - fadeOut, c.end], [1, 0], { extrapolateLeft: "clamp" }) : 1;
  return Math.min(a, b);
};

const Disclosure: React.FC<{ c: Card; s: number }> = ({ c, s }) => {
  const o = useFade(c, 0.6, 0.8);
  return (
    <div
      style={{
        position: "absolute",
        left: 64 * s,
        bottom: 220 * s,
        opacity: o * 0.85,
        fontFamily: BODY_FONT,
        fontWeight: 500,
        fontSize: 24 * s,
        color: "#EDE6DA",
        textShadow: "0 1px 6px rgba(0,0,0,0.8)",
        maxWidth: 760 * s,
      }}
    >
      {c.text}
    </div>
  );
};

const Title: React.FC<{ c: Card; s: number; size: number; weight: number; tracking: string; rule: boolean; holdToEnd?: boolean }> = ({
  c,
  s,
  size,
  weight,
  tracking,
  rule,
  holdToEnd,
}) => {
  const o = useFade(c, 1.0, holdToEnd ? 0 : 1.0);
  const t = useCurrentFrame() / useVideoConfig().fps;
  const lift = interpolate(t, [c.start, c.start + 1.6], [10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: o }}>
      {holdToEnd && <AbsoluteFill style={{ backgroundColor: "rgba(0,0,0,0.45)" }} />}
      <div
        style={{
          transform: `translateY(${lift * s}px)`,
          fontFamily: TITLE_FONT,
          fontWeight: weight,
          fontSize: size * s,
          letterSpacing: tracking,
          color: "#F3EEE6",
          textShadow: "0 4px 24px rgba(0,0,0,0.7)",
          textAlign: "center",
          paddingLeft: tracking,
        }}
      >
        {c.text}
      </div>
      {rule && <div style={{ marginTop: 18 * s, width: 140 * s, height: 3 * s, backgroundColor: AMBER, opacity: 0.9 }} />}
    </AbsoluteFill>
  );
};

const LowerThird: React.FC<{ c: Card; s: number }> = ({ c, s }) => {
  const o = useFade(c, 0.8, 0.8);
  return (
    <div
      style={{
        position: "absolute",
        left: 96 * s,
        bottom: 300 * s,
        opacity: o,
        display: "flex",
        alignItems: "stretch",
        gap: 18 * s,
      }}
    >
      <div style={{ width: 5 * s, backgroundColor: AMBER }} />
      <div
        style={{
          fontFamily: BODY_FONT,
          fontWeight: 500,
          fontSize: 32 * s,
          color: "#F3EEE6",
          padding: `${10 * s}px ${22 * s}px ${10 * s}px ${4 * s}px`,
          background: "linear-gradient(90deg, rgba(0,0,0,0.55), rgba(0,0,0,0))",
          textShadow: "0 1px 6px rgba(0,0,0,0.8)",
        }}
      >
        {c.text}
      </div>
    </div>
  );
};

export const TextCards: React.FC<{ text: ResolvedPlan["text"] }> = ({ text }) => {
  const s = useVideoConfig().width / 1920;
  return (
    <>
      {text.map((c, i) => {
        switch (c.type) {
          case "disclosure":
            return <Disclosure key={i} c={c} s={s} />;
          case "title_card":
            return <Title key={i} c={c} s={s} size={128} weight={700} tracking="0.14em" rule />;
          case "episode_title":
            return <Title key={i} c={c} s={s} size={84} weight={400} tracking="0.04em" rule={false} />;
          case "end_card":
            return <Title key={i} c={c} s={s} size={128} weight={700} tracking="0.14em" rule holdToEnd />;
          case "lower_third":
            return <LowerThird key={i} c={c} s={s} />;
          default:
            return null;
        }
      })}
    </>
  );
};
