// Automatic shot pictures through fal.ai (FLUX schnell by default, FLUX.2 Pro per show).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fal } from "@fal-ai/client";
import { imagePrompt, type EditPlan, type ShowProfile } from "@shoebox/edit-plan";
import { optional } from "./env";
import { uploadFile } from "./supabase";

const ENDPOINT: Record<Exclude<ShowProfile["autopilot"]["imageModel"], "none">, string> = {
  "flux-schnell": "fal-ai/flux/schnell",
  "flux-2-pro": "fal-ai/flux-2-pro",
};
const MAX_IMAGES = Number(optional("MAX_IMAGES_PER_EPISODE") ?? 60);

export const imagesConfigured = () => !!optional("FAL_KEY");

/**
 * Generate a picture for every shot that has a prompt and no image yet, upload
 * them to inputs/<episode>/images/, and point the plan's shots at them.
 * Returns the new assets (plan-relative path -> storage key). Failures leave
 * that shot as a placeholder and are reported, never fatal.
 */
export async function generateShotImages(
  episodeId: string,
  plan: EditPlan,
  profile: ShowProfile,
  dir: string,
  log: (m: string) => void,
): Promise<{ assets: Record<string, string>; generated: number; failed: string[] }> {
  const model = profile.autopilot.imageModel;
  const assets: Record<string, string> = {};
  const failed: string[] = [];
  if (model === "none") return { assets, generated: 0, failed };
  if (!imagesConfigured()) {
    log("FAL_KEY is not set; shots stay as placeholders");
    return { assets, generated: 0, failed };
  }
  fal.config({ credentials: optional("FAL_KEY") });
  const todo = plan.shots.filter((s) => !s.visual.src && s.visual.prompt).slice(0, MAX_IMAGES);
  mkdirSync(join(dir, "images"), { recursive: true });

  let generated = 0;
  // A few at a time: quick, and gentle on rate limits.
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async (shot) => {
        try {
          const prompt = imagePrompt(profile, shot.visual.prompt!);
          const res = await fal.subscribe(ENDPOINT[model], {
            input: {
              prompt,
              image_size: { width: 1920, height: 1080 },
              num_images: 1,
              output_format: "jpeg",
              enable_safety_checker: true,
              ...(model === "flux-schnell" ? { num_inference_steps: 4 } : {}),
            } as any,
          });
          const url = (res.data as { images?: Array<{ url: string }> }).images?.[0]?.url;
          if (!url) throw new Error("no image returned");
          const img = Buffer.from(await (await fetch(url)).arrayBuffer());
          const rel = `images/${shot.id}-${createHash("sha1").update(img).digest("hex").slice(0, 10)}.jpg`;
          writeFileSync(join(dir, rel), img);
          const key = `inputs/${episodeId}/${rel}`;
          await uploadFile(join(dir, rel), key, "image/jpeg");
          assets[rel] = key;
          shot.visual = { ...shot.visual, type: "image", src: rel };
          generated++;
          log(`image for ${shot.id} (${model})`);
        } catch (e) {
          failed.push(shot.id);
          // fal's ApiError carries the useful reason (e.g. an exhausted balance) in its body.
          const body = (e as { body?: unknown }).body;
          log(`image for ${shot.id} failed: ${e instanceof Error ? e.message : e}${body ? ` ${JSON.stringify(body).slice(0, 300)}` : ""}`);
        }
      }),
    );
  }
  return { assets, generated, failed };
}
