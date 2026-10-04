"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { profileTextIssues, scriptIssues, ShowProfile } from "@shoebox/edit-plan";
import { supabaseServer } from "@/lib/supabase/server";

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export async function saveShow(id: string, raw: unknown): Promise<void> {
  const parsed = ShowProfile.safeParse(raw);
  if (!parsed.success) throw new Error(`Not saved: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  const problems = profileTextIssues(parsed.data);
  if (problems.length) throw new Error(`Not saved: ${problems.join("; ")}`);
  const supabase = await supabaseServer();
  const { error } = await supabase.from("shows").update({ name: parsed.data.name, profile: parsed.data }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/shows");
  revalidatePath(`/shows/${id}`);
}

/** A new show starts as a copy of an existing one, renamed. */
export async function createShow(form: FormData): Promise<void> {
  const name = String(form.get("name") ?? "").trim();
  const id = String(form.get("id") ?? "").trim().toLowerCase();
  const from = String(form.get("from") ?? "");
  if (!name || !SLUG.test(id)) redirect(`/shows?error=${encodeURIComponent("Give the show a name and a short id (lowercase letters, numbers and dashes).")}`);
  const supabase = await supabaseServer();
  const { data: src } = await supabase.from("shows").select("profile").eq("id", from).maybeSingle();
  if (!src) redirect(`/shows?error=${encodeURIComponent("Pick a show to copy settings from.")}`);
  const profile = ShowProfile.parse({ ...src.profile, name, titleCard: name.toUpperCase(), shorts: { ...src.profile.shorts, endCardText: `More on ${name}` } });
  const { error } = await supabase.from("shows").insert({ id, name, profile });
  if (error) redirect(`/shows?error=${encodeURIComponent(error.code === "23505" ? "A show with that id already exists." : error.message)}`);
  redirect(`/shows/${id}`);
}

/**
 * Create an episode from a script and queue its first voicing. The worker voices
 * every paragraph, then builds a starter plan in the show's style.
 */
export async function createEpisode(showId: string, title: string, episodeId: string, script: string): Promise<void> {
  if (!title.trim()) throw new Error("Give the episode a title.");
  if (!SLUG.test(episodeId)) throw new Error("The episode id needs lowercase letters, numbers and dashes (3-50 characters).");
  const issues = scriptIssues(script);
  if (issues.errors.length) throw new Error(`Fix these first: ${issues.errors.join(" ")}`);
  if (!issues.characters) throw new Error("The script is empty.");
  const supabase = await supabaseServer();
  const { error } = await supabase.from("episodes").insert({ id: episodeId, show: showId, title: title.trim(), status: "scripted", script, plan: null });
  if (error) throw new Error(error.code === "23505" ? "An episode with that id already exists." : error.message);
  const { error: jobErr } = await supabase.from("render_jobs").insert({
    episode_id: episodeId,
    kind: "voice",
    plan: {},
    assets: {},
    options: { script, maxCharacters: issues.characters + 50 },
    max_attempts: 1,
  });
  if (jobErr) throw new Error(jobErr.message);
  revalidatePath("/");
  redirect(`/episodes/${encodeURIComponent(episodeId)}`);
}
