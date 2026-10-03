"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export async function sendLink(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = await supabaseServer();
  // shouldCreateUser: false. Only the existing owner account can get a link.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error && error.status === 429) redirect(`/login?error=${encodeURIComponent("Too many requests. Wait a minute and try again.")}`);
  // Same message either way, so the page never reveals which emails have accounts.
  redirect("/login?sent=1");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
