"use client";
import { useEffect, useState } from "react";

/** Peak levels (0..1) of an audio file at `perSecond` resolution, decoded in the browser. */
export function useWaveform(url: string, perSecond = 20): number[] | null {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const ctx = new AudioContext();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close();
        const data = audio.getChannelData(0);
        const step = Math.floor(audio.sampleRate / perSecond);
        const out: number[] = [];
        let max = 0;
        for (let i = 0; i < data.length; i += step) {
          let peak = 0;
          for (let j = i; j < Math.min(i + step, data.length); j++) peak = Math.max(peak, Math.abs(data[j]));
          out.push(peak);
          max = Math.max(max, peak);
        }
        if (!cancelled) setPeaks(out.map((p) => p / (max || 1)));
      } catch {
        if (!cancelled) setPeaks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, perSecond]);
  return peaks;
}
