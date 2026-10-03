"use client";
import { Player } from "@remotion/player";
import { Episode } from "@shoebox/engine/episode";
import type { ResolvedPlan } from "@shoebox/edit-plan";

/** The same Episode composition the worker renders, played live in the browser. */
export function PreviewPlayer({ plan, labels }: { plan: ResolvedPlan; labels: boolean }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-black">
      <Player
        component={Episode}
        inputProps={{ plan, placeholderLabels: labels }}
        durationInFrames={Math.ceil(plan.durationSec * plan.fps)}
        fps={plan.fps}
        compositionWidth={plan.width}
        compositionHeight={plan.height}
        style={{ width: "100%", aspectRatio: `${plan.width} / ${plan.height}` }}
        controls
        allowFullscreen
        clickToPlay
        doubleClickToFullscreen
        spaceKeyToPlayOrPause
        showVolumeControls
        acknowledgeRemotionLicense
      />
    </div>
  );
}
