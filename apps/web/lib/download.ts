"use client";
import { supabaseBrowser } from "./supabase/client";

/** Download a file from the private studio bucket via a short-lived signed link. */
export async function downloadKey(key: string) {
  const name = key.slice(key.lastIndexOf("/") + 1);
  const { data, error } = await supabaseBrowser().storage.from("studio").createSignedUrl(key, 3600, { download: name });
  if (error || !data) return alert(error?.message ?? "Could not create a download link.");
  window.location.href = data.signedUrl;
}
