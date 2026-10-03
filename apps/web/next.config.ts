import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(process.cwd(), "../..");

// Read only the two public Supabase values from the repo-root .env.
// The secret keys in that file are never loaded into the web app.
function fromRootEnv(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const file = resolve(repoRoot, ".env");
  if (!existsSync(file)) return undefined;
  return new RegExp(`^${name}=(.*)$`, "m").exec(readFileSync(file, "utf8"))?.[1]?.trim();
}

const config: NextConfig = {
  transpilePackages: ["@shoebox/engine", "@shoebox/edit-plan", "@shoebox/text-rules"],
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: fromRootEnv("SUPABASE_URL") ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: fromRootEnv("SUPABASE_PUBLISHABLE_KEY") ?? "",
  },
};

export default config;
