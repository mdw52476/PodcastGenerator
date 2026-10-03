import { openSync, readSync, closeSync, statSync } from "node:fs";
import { need, optional } from "./env";

// Dropbox app with "App folder" access: paths are relative to /Apps/<app name>/.

export const dropboxConfigured = () => !!(optional("DROPBOX_APP_KEY") && optional("DROPBOX_APP_SECRET") && optional("DROPBOX_REFRESH_TOKEN"));

let cached: { token: string; expires: number } | undefined;
async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: need("DROPBOX_REFRESH_TOKEN"),
      client_id: need("DROPBOX_APP_KEY"),
      client_secret: need("DROPBOX_APP_SECRET"),
    }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed: HTTP ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function content(endpoint: string, arg: unknown, body: Uint8Array): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://content.dropboxapi.com/2/${endpoint}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        "content-type": "application/octet-stream",
        // Dropbox-API-Arg must be ASCII; escape anything else.
        "dropbox-api-arg": JSON.stringify(arg).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`),
      },
      body: new Blob([body as Uint8Array<ArrayBuffer>]),
    });
    if (res.ok) return res.headers.get("content-type")?.includes("json") ? res.json() : null;
    const text = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`Dropbox ${endpoint}: HTTP ${res.status} ${text}`);
  }
}

const CHUNK = 32 * 1024 * 1024;

/** Upload a local file to Dropbox, overwriting. Uses an upload session so files of any size work. */
export async function dropboxUpload(localPath: string, dropboxPath: string): Promise<void> {
  const size = statSync(localPath).size;
  const fd = openSync(localPath, "r");
  try {
    const buf = Buffer.alloc(Math.min(CHUNK, Math.max(1, size)));
    const read = (offset: number) => {
      const n = readSync(fd, buf, 0, Math.min(CHUNK, size - offset), offset);
      return new Uint8Array(buf.subarray(0, n));
    };
    const commit = { path: dropboxPath, mode: "overwrite", mute: true };
    if (size <= CHUNK) {
      await content("files/upload", commit, read(0));
      return;
    }
    const { session_id } = await content("files/upload_session/start", { close: false }, read(0));
    let offset = CHUNK;
    while (size - offset > CHUNK) {
      await content("files/upload_session/append_v2", { cursor: { session_id, offset }, close: false }, read(offset));
      offset += CHUNK;
    }
    await content("files/upload_session/finish", { cursor: { session_id, offset }, commit }, read(offset));
  } finally {
    closeSync(fd);
  }
}
