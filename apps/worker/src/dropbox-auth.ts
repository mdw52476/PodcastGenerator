// pnpm dropbox-auth
// One-time, interactive: connects the "Shoebox Studio" Dropbox app and saves
// DROPBOX_APP_KEY, DROPBOX_APP_SECRET and DROPBOX_REFRESH_TOKEN into the repo-root .env.
// Run it yourself in a terminal; the values never get printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { REPO_DIR } from "@shoebox/engine/pipeline";

const envPath = join(REPO_DIR, ".env");
const rl = createInterface({ input: process.stdin, output: process.stdout });

console.log("Dropbox app setup. In the Dropbox App Console, open your app's Settings tab.\n");
const key = (await rl.question("Paste the App key, then Enter: ")).trim();
const secret = (await rl.question("Paste the App secret (click Show first), then Enter: ")).trim();

const url = `https://www.dropbox.com/oauth2/authorize?client_id=${encodeURIComponent(key)}&response_type=code&token_access_type=offline`;
console.log(`\nOpen this link in your browser, click Continue, then Allow:\n\n  ${url}\n`);
const code = (await rl.question("Dropbox shows an access code. Paste it here, then Enter: ")).trim();
rl.close();

const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code, grant_type: "authorization_code", client_id: key, client_secret: secret }),
});
if (!res.ok) {
  console.error(`\nDropbox said no (HTTP ${res.status}). Check the key/secret and use a fresh code (codes expire quickly).`);
  process.exit(1);
}
const tok = (await res.json()) as { refresh_token?: string; access_token: string };
if (!tok.refresh_token) {
  console.error("\nDropbox did not return a refresh token. Run this again and use the link exactly as printed.");
  process.exit(1);
}

// Quick write test in the app folder.
const test = await fetch("https://content.dropboxapi.com/2/files/upload", {
  method: "POST",
  headers: {
    authorization: `Bearer ${tok.access_token}`,
    "content-type": "application/octet-stream",
    "dropbox-api-arg": JSON.stringify({ path: "/connection-test.txt", mode: "overwrite", mute: true }),
  },
  body: `Shoebox Studio connected ${new Date().toISOString()}\n`,
});

const values: Record<string, string> = { DROPBOX_APP_KEY: key, DROPBOX_APP_SECRET: secret, DROPBOX_REFRESH_TOKEN: tok.refresh_token };
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
for (const [k, v] of Object.entries(values)) {
  const line = `${k}=${v}`;
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${env.replace(/\n?$/, "\n")}${line}\n`;
}
writeFileSync(envPath, env.replace(/^\n/, ""));

console.log(`\nSaved the three Dropbox values to ${envPath}.`);
console.log(test.ok ? "Test file written: Dropbox > Apps > (your app) > connection-test.txt. You can delete it." : `Saved, but the test upload failed (HTTP ${test.status}). Check the app's Permissions tab has files.content.write ticked, then run this again.`);
