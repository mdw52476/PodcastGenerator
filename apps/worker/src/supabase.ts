import { createReadStream, createWriteStream, readFileSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as tus from "tus-js-client";
import { BUCKET, need } from "./env";

export interface RenderJob {
  id: string;
  episode_id: string;
  kind: "episode" | "preview";
  plan: Record<string, any>;
  assets: Record<string, string>;
  options: { frames?: [number, number]; strict?: boolean; labels?: boolean; proxy?: boolean; dropbox?: boolean };
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  stage: string | null;
  progress: number;
  outputs: Record<string, any> | null;
  error: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

let client: SupabaseClient | undefined;
export function db(): SupabaseClient {
  client ??= createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

const STANDARD_LIMIT = 6 * 1024 * 1024; // Supabase recommends resumable uploads above 6 MB

/** Upload a local file to Storage, overwriting any existing object. Large files go up in resumable 6 MB chunks. */
export async function uploadFile(localPath: string, key: string, contentType: string): Promise<void> {
  const size = statSync(localPath).size;
  if (size <= STANDARD_LIMIT) {
    const { error } = await db().storage.from(BUCKET).upload(key, readFileSync(localPath), { contentType, upsert: true });
    if (error) throw new Error(`upload ${key}: ${error.message}`);
    return;
  }
  const projectRef = new URL(need("SUPABASE_URL")).hostname.split(".")[0];
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(createReadStream(localPath), {
      endpoint: `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      // Both headers so either key style works (legacy service_role JWT or new sb_secret_ key).
      headers: { apikey: need("SUPABASE_SERVICE_ROLE_KEY"), authorization: `Bearer ${need("SUPABASE_SERVICE_ROLE_KEY")}`, "x-upsert": "true" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: STANDARD_LIMIT,
      uploadSize: size,
      metadata: { bucketName: BUCKET, objectName: key, contentType, cacheControl: "3600" },
      onError: reject,
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

/** Download a Storage object to a local path. */
export async function downloadFile(key: string, localPath: string): Promise<void> {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(key, 600);
  if (error || !data) throw new Error(`download ${key}: ${error?.message ?? "no url"}`);
  const res = await fetch(data.signedUrl);
  if (!res.ok || !res.body) throw new Error(`download ${key}: HTTP ${res.status}`);
  await mkdir(dirname(localPath), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(localPath));
}

export async function objectExists(key: string): Promise<boolean> {
  const slash = key.lastIndexOf("/");
  const { data } = await db().storage.from(BUCKET).list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 1 });
  return !!data?.some((o) => o.name === key.slice(slash + 1));
}

export async function signedUrl(key: string, seconds = 7 * 24 * 3600): Promise<string | undefined> {
  const { data } = await db().storage.from(BUCKET).createSignedUrl(key, seconds);
  return data?.signedUrl;
}
