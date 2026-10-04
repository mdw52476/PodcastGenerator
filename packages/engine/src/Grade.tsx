import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import type { ResolvedPlan } from "@shoebox/edit-plan";

type Grade = ResolvedPlan["grade"];

/**
 * Transfer tables for the look: contrast S-curve plus split toning
 * (teal pushed into the shadows, amber into the highlights).
 */
export function gradeTables(g: Grade, steps = 17) {
  const r: number[] = [], gr: number[] = [], b: number[] = [];
  const teal = g.tint.includes("teal") ? 1 : 0;
  // Overall colour cast for the simpler looks: warm leans amber, cool leans blue.
  const cast = g.tint === "warm" ? { r: 0.035, g: 0.012, b: -0.04 } : g.tint === "cool" ? { r: -0.03, g: 0.005, b: 0.04 } : { r: 0, g: 0, b: 0 };
  for (let i = 0; i < steps; i++) {
    const x = i / (steps - 1);
    // Contrast around mid-grey, softened at the ends so blacks stay a touch lifted (filmic).
    const c = Math.min(1, Math.max(0, 0.5 + (x - 0.5) * g.contrast)) * 0.96 + 0.025;
    const sh = (1 - x) ** 2 * teal; // shadow weight
    const hi = x ** 2 * teal; // highlight weight
    const mid = 4 * x * (1 - x); // cast is strongest in the midtones
    r.push(c + 0.07 * hi - 0.05 * sh + cast.r * mid);
    gr.push(c + 0.025 * hi + 0.015 * sh + cast.g * mid);
    b.push(c - 0.07 * hi + 0.055 * sh + cast.b * mid);
  }
  const fmt = (a: number[]) => a.map((v) => Math.min(1, Math.max(0, v)).toFixed(4)).join(" ");
  return { r: fmt(r), g: fmt(gr), b: fmt(b) };
}

/** SVG filter applied to the picture layer: saturation, curves + split tone, halation. */
export const GradeFilter: React.FC<{ id: string; grade: Grade }> = ({ id, grade }) => {
  const t = gradeTables(grade);
  return (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
          <feColorMatrix type="saturate" values={String(grade.saturation)} result="sat" />
          <feComponentTransfer in="sat" result="graded">
            <feFuncR type="table" tableValues={t.r} />
            <feFuncG type="table" tableValues={t.g} />
            <feFuncB type="table" tableValues={t.b} />
          </feComponentTransfer>
          {/* Halation: keep only the brightest areas, blur them, tint red-orange, add back. */}
          <feComponentTransfer in="graded" result="hot">
            <feFuncR type="linear" slope="3.2" intercept="-2.2" />
            <feFuncG type="linear" slope="3.2" intercept="-2.2" />
            <feFuncB type="linear" slope="3.2" intercept="-2.2" />
          </feComponentTransfer>
          <feGaussianBlur in="hot" stdDeviation="18" result="glow" />
          <feColorMatrix in="glow" type="matrix" values="1 0 0 0 0  0 0.42 0 0 0  0 0 0.15 0 0  0 0 0 1 0" result="tinted" />
          <feComposite in="graded" in2="tinted" operator="arithmetic" k1="0" k2="1" k3={String(grade.halation * 3)} k4="0" />
        </filter>
      </defs>
    </svg>
  );
};

/** Vignette and animated film grain, drawn above the picture (below text). */
export const GradeOverlay: React.FC<{ grade: Grade }> = ({ grade }) => {
  const frame = useCurrentFrame();
  return (
    <>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 45%, rgba(0,0,0,${Math.min(0.95, grade.vignette * 3.2)}) 100%)`,
        }}
      />
      <AbsoluteFill style={{ mixBlendMode: "overlay", opacity: Math.min(1, grade.grain * 3.5) }}>
        <svg width="100%" height="100%">
          <filter id="grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={frame % 97} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#grain)" />
        </svg>
      </AbsoluteFill>
    </>
  );
};
