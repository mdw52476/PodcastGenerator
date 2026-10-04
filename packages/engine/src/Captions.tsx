import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionPage, ResolvedPlan } from "@shoebox/edit-plan";
import { BODY_FONT } from "./fonts";

function pageAt(pages: CaptionPage[], t: number): CaptionPage | undefined {
  let lo = 0, hi = pages.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].start <= t) lo = mid + 1;
    else hi = mid - 1;
  }
  const p = pages[hi];
  return p && t < p.end ? p : undefined;
}

export interface CaptionLayout {
  /** Distance from the bottom, or from the top when `top` is set (px at this composition's size). */
  bottom?: number;
  top?: number;
  left?: number;
  right?: number;
  fontSize: number;
}

/**
 * Word-highlight captions: up to two lines, active word in amber.
 * Default layout: bottom centre of a 16:9 frame. Shorts pass their own layout and pages.
 */
export const Captions: React.FC<{ captions: ResolvedPlan["captions"]; pages?: CaptionPage[]; layout?: CaptionLayout }> = ({
  captions,
  pages,
  layout,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;
  const page = pageAt(pages ?? captions.pages, t);
  if (!captions.enabled || !page) return null;

  const words = page.lines.flat();
  // The active word stays lit through the micro-gap until the next word starts.
  let active = -1;
  for (let i = 0; i < words.length; i++) if (words[i].start <= t) active = words[i].index;
  const fade = interpolate(t, [page.start, page.start + 0.12, page.end - 0.12, page.end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const scale = layout ? layout.fontSize / 50 : width / 1920;
  const place = layout
    ? { left: layout.left ?? 0, right: layout.right ?? 0, ...(layout.top !== undefined ? { top: layout.top } : { bottom: layout.bottom ?? 0 }) }
    : { left: 0, right: 0, bottom: 84 * scale };

  return (
    <div
      style={{
        position: "absolute",
        ...place,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6 * scale,
        opacity: fade,
        fontFamily: BODY_FONT,
        fontWeight: 600,
        fontSize: 50 * scale,
        lineHeight: 1.2,
        letterSpacing: "0.005em",
        textShadow: `0 ${2 * scale}px ${10 * scale}px rgba(0,0,0,0.85), 0 0 ${3 * scale}px rgba(0,0,0,0.9)`,
      }}
    >
      {page.lines.map((line, li) => (
        <div key={li} style={{ whiteSpace: "nowrap" }}>
          {line.map((w, wi) => (
            <span key={w.index} style={{ color: w.index === active ? captions.highlightColor : captions.color }}>
              {w.text}
              {wi < line.length - 1 ? " " : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};
