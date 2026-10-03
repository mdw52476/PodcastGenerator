import type { ResolvedPlan } from "./resolve";

export const dbToGain = (db: number) => Math.pow(10, db / 20);

const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** How much the music should be ducked at time t: 1 = fully under voice, 0 = open. */
export function duckAmount(spans: ResolvedPlan["voiceSpans"], t: number, attackSec = 0.25, releaseSec = 0.8): number {
  // Binary search for the span at or before t.
  let lo = 0, hi = spans.length - 1, k = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid][0] - attackSec <= t) { k = mid; lo = mid + 1; } else hi = mid - 1;
  }
  let amt = 0;
  for (const j of [k, k + 1]) {
    const s = spans[j];
    if (!s) continue;
    const [a, b] = s;
    if (t >= a && t <= b) return 1;
    if (t < a) amt = Math.max(amt, smooth(1 - (a - t) / attackSec)); // dip just before Walt starts
    else amt = Math.max(amt, smooth(1 - (t - b) / releaseSec)); // recover after he stops
  }
  return amt;
}

/**
 * Linear gain for a music track at time t (seconds on the episode timeline):
 * base level, fades, and ducking under the narration.
 * Fade-out runs past `end` so consecutive tracks crossfade instead of dipping.
 */
export function musicGain(m: ResolvedPlan["music"][number], spans: ResolvedPlan["voiceSpans"], t: number): number {
  if (t < m.start || t > m.end + m.fadeOutSec) return 0;
  const fadeIn = m.fadeInSec > 0 ? smooth((t - m.start) / m.fadeInSec) : 1;
  const fadeOut = t <= m.end ? 1 : m.fadeOutSec > 0 ? smooth(1 - (t - m.end) / m.fadeOutSec) : 0;
  const duckDb = m.duckUnderVoiceDb * duckAmount(spans, t);
  return dbToGain(m.levelDb + duckDb) * fadeIn * fadeOut;
}
