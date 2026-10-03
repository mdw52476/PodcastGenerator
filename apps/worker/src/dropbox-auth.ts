// pnpm dropbox-auth
// One-time: connects the "Shoebox Studio" Dropbox app and saves DROPBOX_REFRESH_TOKEN
// into the repo-root .env. Everything is pasted into .env with Notepad; nothing is typed
// into the terminal and no secret is printed.
//
//   1. notepad .env  -> fill DROPBOX_APP_KEY and DROPBOX_APP_SECRET, save
//   2. pnpm dropbox-auth  -> prints a link; approve it, paste the code into .env as DROPBOX_AUTH_CODE, save
//   3. pnpm dropbox-auth  -> exchanges the code, saves DROPBOX_REFRESH_TOKEN, writes a test file
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "@shoebox/engine/pipeline";

const envPath = join(REPO_DIR, ".env");
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

const read = (k: string) => (new RegExp(`^${k}=(.*)$`, "m").exec(env)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
function write(k: string, v: string) {
  const re = new RegExp(`^${k}=.*$`, "m");
  env = re.test(env) ? env.replace(re, `${k}=${v}`) : `${env.replace(/\n?$/, "\n")}${k}=${v}\n`;
  writeFileSync(envPath, env);
}
const done = (msg: string, code = 0): never => {
  console.log(msg);
  process.exit(code);
};

const key = read("DROPBOX_APP_KEY");
const secret = read("DROPBOX_APP_SECRET");
let code = read("DROPBOX_AUTH_CODE");

// Approval codes are ~43 chars; real refresh tokens are longer. If the code landed on the
// refresh-token line (they sit next to each other), use it as the code.
const misplaced = read("DROPBOX_REFRESH_TOKEN");
if (!code && misplaced && misplaced.length < 50) {
  console.log("The access code was on the DROPBOX_REFRESH_TOKEN line; using it as the code.");
  code = misplaced;
  write("DROPBOX_REFRESH_TOKEN", "");
}

if (!key || !secret) {
  if (!/^DROPBOX_AUTH_CODE=/m.test(env)) write("DROPBOX_AUTH_CODE", "");
  done(
    `Step 1: open .env in Notepad (run: notepad .env) and fill in, from your Dropbox app's Settings tab:\n` +
      `  DROPBOX_APP_KEY=     <- the App key\n` +
      `  DROPBOX_APP_SECRET=  <- the App secret (click Show)\n` +
      `Save, then run pnpm dropbox-auth again.`,
  );
}
if (key === secret) done("DROPBOX_APP_KEY and DROPBOX_APP_SECRET are the same; one was pasted twice. Fix .env and run again.", 1);

if (!code) {
  if (!/^DROPBOX_AUTH_CODE=/m.test(env)) write("DROPBOX_AUTH_CODE", "");
  const url = `https://www.dropbox.com/oauth2/authorize?client_id=${encodeURIComponent(key)}&response_type=code&token_access_type=offline`;
  done(
    `Step 2: open this link in your browser, click Continue, then Allow:\n\n  ${url}\n\n` +
      `Dropbox shows an access code. Open .env in Notepad, paste it after DROPBOX_AUTH_CODE=, save,\n` +
      `then run pnpm dropbox-auth again within a few minutes (codes expire).`,
  );
}

const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ code, grant_type: "authorization_code", client_id: key, client_secret: secret }),
});
if (!res.ok) {
  write("DROPBOX_AUTH_CODE", "");
  done(
    `Dropbox did not accept that (HTTP ${res.status}). The code may have expired or been used already, or the key/secret are swapped.\n` +
      `I cleared DROPBOX_AUTH_CODE; run pnpm dropbox-auth again for a fresh link.`,
    1,
  );
}
const tok = (await res.json()) as { refresh_token?: string; access_token: string };
if (!tok.refresh_token) done("Dropbox did not return a refresh token. Run pnpm dropbox-auth again and use the link exactly as printed.", 1);

write("DROPBOX_REFRESH_TOKEN", tok.refresh_token!);
write("DROPBOX_AUTH_CODE", "");

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

console.log("Step 3 done: Dropbox is connected and the refresh token is saved in .env.");
console.log(
  test.ok
    ? "Test file written: Dropbox > Apps > Shoebox Studio > connection-test.txt. You can delete it."
    : `The test upload failed (HTTP ${test.status}). Check the app's Permissions tab has files.content.write ticked and Submit pressed, then run pnpm dropbox-auth again.`,
);
