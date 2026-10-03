import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "@shoebox/engine/pipeline";

// Local runs read the repo-root .env (never committed). On Railway, variables come from the service settings.
const envFile = join(REPO_DIR, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Locally, add it to ${envFile}; on Railway, add it under the service's Variables tab.`);
  return v;
}

export const optional = (name: string) => process.env[name] || undefined;

export const BUCKET = process.env.STORAGE_BUCKET ?? "studio";
