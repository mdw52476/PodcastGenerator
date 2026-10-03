// pnpm render --plan fixtures/ep01/edit-plan.json [--out out/ep01] [--strict] [--no-labels]
//              [--frames 0-899] [--no-proxy] [--concurrency 4]
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, PlanError, REPO_DIR, renderEpisode } from "../pipeline";

const args = parseArgs(process.argv.slice(2));
if (typeof args.plan !== "string") {
  console.error("usage: pnpm render --plan <edit-plan.json> [--out dir] [--strict] [--no-labels] [--frames a-b] [--no-proxy]");
  process.exit(1);
}
const episodeId: string = JSON.parse(readFileSync(resolve(args.plan), "utf8")).episode?.id ?? "episode";
const started = Date.now();
let lastStage = "";

try {
  const r = await renderEpisode({
    planPath: args.plan,
    outDir: typeof args.out === "string" ? args.out : join(REPO_DIR, "out", episodeId),
    strict: args.strict === true,
    labels: args["no-labels"] !== true,
    frames: typeof args.frames === "string" ? (args.frames.split("-").map(Number) as [number, number]) : null,
    proxy: args["no-proxy"] !== true,
    concurrency: typeof args.concurrency === "string" ? Number(args.concurrency) : undefined,
    onEvent: (e) => {
      if (!e.message) return;
      const t = `[${((Date.now() - started) / 1000).toFixed(0).padStart(4)}s]`;
      if (e.stage !== lastStage) console.log(`\n${t} ${e.message}`);
      else console.log(`  ${e.message}`);
      lastStage = e.stage;
    },
  });
  console.log(`\n  ${r.finalPath}${r.proxyPath ? `\n  ${r.proxyPath}` : ""}`);
} catch (err) {
  if (err instanceof PlanError) {
    console.error(`\n${err.message}\n\nFix the errors above, then render again.`);
    process.exit(1);
  }
  throw err;
}
