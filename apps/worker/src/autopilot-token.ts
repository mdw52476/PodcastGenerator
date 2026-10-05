// pnpm autopilot:token
// Makes a new autopilot token for the scheduled writer and saves it to the repo-root
// .env as STUDIO_AUTOPILOT_TOKEN (copy it from there into the routine's environment).
// Prints only the token's SHA-256 hash, which is what the database stores.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "@shoebox/engine/pipeline";

const token = `sbx_ap_${randomBytes(32).toString("base64url")}`;
const hash = createHash("sha256").update(token).digest("hex");
const envPath = join(REPO_DIR, ".env");
let env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const line = `STUDIO_AUTOPILOT_TOKEN=${token}`;
env = /^STUDIO_AUTOPILOT_TOKEN=.*$/m.test(env) ? env.replace(/^STUDIO_AUTOPILOT_TOKEN=.*$/m, line) : `${env.replace(/\n?$/, "\n")}${line}\n`;
writeFileSync(envPath, env);
console.log(`Saved a new token to ${envPath} as STUDIO_AUTOPILOT_TOKEN.`);
console.log(`Register this hash in private.autopilot_tokens: ${hash}`);
