import React from "react";
import { AbsoluteFill, Img, interpolate, OffthreadVideo, random, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import type { Motion, ResolvedPlan } from "@shoebox/edit-plan";
import { asset } from "./assets";
import { BODY_FONT } from "./fonts";

type ShotData = ResolvedPlan["shots"][number];

/** Slow Ken Burns moves. `p` runs 0..1 across the shot. Max ~8% zoom; never fast. */
export function motionTransform(motion: Motion, p: number, frame: number, fps: number): string {
  const e = Easing.inOut(Easing.sin)(p);
  switch (motion) {
    case "push_in":
      return `scale(${1.0 + 0.08 * e})`;
    case "pull_out":
      return `scale(${1.08 - 0.08 * e})`;
    case "drift_left":
      return `scale(1.07) translateX(${2.2 - 4.4 * e}%)`;
    case "drift_right":
      return `scale(1.07) translateX(${-2.2 + 4.4 * e}%)`;
    case "pan_up":
      return `scale(1.08) translateY(${-3 + 6 * e}%)`;
    case "static_sway": {
      const s = frame / fps;
      return `scale(1.045) translate(${0.5 * Math.sin(s / 1.3)}%, ${0.35 * Math.sin(s / 1.9 + 1)}%) rotate(${0.25 * Math.sin(s / 2.3)}deg)`;
    }
    case "static":
    default:
      return `scale(${1.02 + 0.01 * e})`;
  }
}

const has = (prompt: string | undefined, words: string[]) => !!prompt && words.some((w) => prompt.toLowerCase().includes(w));

/**
 * Stand-in picture for a shot with no image yet: a graded gradient composed
 * from hints in the prompt (sea, night, lamp, dawn...) so pacing, motion and
 * the grade can be judged before real images exist.
 */
const Placeholder: React.FC<{ shot: ShotData }> = ({ shot }) => {
  const p = shot.prompt ?? "";
  const rnd = (k: string) => random(`${shot.id}-${k}`);
  const night = has(p, ["night", "dusk", "moon", "dark", "lamp", "neon"]);
  const warm = has(p, ["dawn", "sun", "morning", "lamp", "coffee", "kitchen", "brass"]);
  const water = has(p, ["ocean", "sea", "beach", "water", "surf", "shore", "buoy", "harbor", "swell"]);
  const wide = shot.shotType === "wide";

  const sky = night ? ["#0b1418", "#1b2a33"] : warm ? ["#3b3a36", "#8a7457"] : ["#2b3a40", "#7d8c8e"];
  const ground = water ? (night ? ["#071014", "#0f1c22"] : ["#2a3a3f", "#11191c"]) : night ? ["#0d0c0b", "#1c1814"] : ["#2a2620", "#141210"];
  const horizon = 48 + rnd("h") * 14;
  const lightX = 20 + rnd("lx") * 60;
  const lightY = wide ? horizon - 4 - rnd("ly") * 10 : 25 + rnd("ly") * 30;

  return (
    <AbsoluteFill style={{ backgroundColor: "#111" }}>
      {wide ? (
        <AbsoluteFill
          style={{
            background: `linear-gradient(180deg, ${sky[0]} 0%, ${sky[1]} ${horizon}%, ${ground[0]} ${horizon + 0.4}%, ${ground[1]} 100%)`,
          }}
        />
      ) : (
        <AbsoluteFill style={{ background: `linear-gradient(170deg, ${sky[0]} 0%, ${ground[1]} 100%)` }} />
      )}
      {/* Main practical light: lamp, sun, or city glow. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${lightX}% ${lightY}%, ${
            warm || night ? "rgba(255,190,120,0.55)" : "rgba(220,230,235,0.45)"
          } 0%, rgba(0,0,0,0) ${wide ? 28 : 38}%)`,
        }}
      />
      {/* Detail shots: a desk/table plane catching the light. */}
      {!wide && (
        <AbsoluteFill
          style={{
            top: `${62 + rnd("d") * 10}%`,
            background: `linear-gradient(180deg, rgba(70,52,36,0.85), rgba(15,11,8,0.95))`,
          }}
        />
      )}
      {/* Soft out-of-focus lights for night scenes. */}
      {night &&
        Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${rnd(`bx${i}`) * 100}%`,
              top: `${(wide ? horizon - 6 : 20) + rnd(`by${i}`) * 14}%`,
              width: 40 + rnd(`bs${i}`) * 70,
              height: 40 + rnd(`bs${i}`) * 70,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255,170,90,0.35), rgba(255,170,90,0) 70%)",
            }}
          />
        ))}
      {/* Haze band at the horizon. */}
      {wide && (
        <AbsoluteFill
          style={{
            background: `linear-gradient(180deg, rgba(0,0,0,0) ${horizon - 10}%, rgba(200,210,210,${night ? 0.06 : 0.16}) ${horizon}%, rgba(0,0,0,0) ${horizon + 12}%)`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};

export const Shot: React.FC<{ shot: ShotData; durationInFrames: number; fadeInFrames: number; placeholderLabels: boolean }> = ({
  shot,
  durationInFrames,
  fadeInFrames,
  placeholderLabels,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  const opacity = fadeInFrames > 0 ? interpolate(frame, [0, fadeInFrames], [0, 1], { extrapolateRight: "clamp" }) : 1;

  let media: React.ReactNode;
  if (!shot.src) media = <Placeholder shot={shot} />;
  else if (shot.mediaType === "video")
    media = <OffthreadVideo src={asset(shot.src)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
  else media = <Img src={asset(shot.src)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />;

  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: motionTransform(shot.motion, p, frame, fps), transformOrigin: "50% 50%" }}>{media}</AbsoluteFill>
      {!shot.src && placeholderLabels && (
        <div
          style={{
            position: "absolute",
            top: 36,
            left: 44,
            right: 44,
            fontFamily: BODY_FONT,
            fontSize: 22,
            lineHeight: 1.35,
            color: "rgba(255,255,255,0.42)",
          }}
        >
          <b>{shot.id}</b> · placeholder · {shot.motion} · {shot.prompt}
        </div>
      )}
    </AbsoluteFill>
  );
};
