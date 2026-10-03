import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const FFMPEG: string = require("ffmpeg-static");
export const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_DIR = resolve(ENGINE_DIR, "../..");
export const PYTHON = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");

/** Run a command; resolve with stdout+stderr, reject with the tail of the output on failure. */
export function run(cmd: string, args: string[], opts: { echo?: boolean } = {}): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = "";
    const onData = (d: Buffer) => {
      out += d.toString();
      if (opts.echo) process.stderr.write(d);
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("error", rej);
    p.on("close", (code) => (code === 0 ? res(out) : rej(new Error(`${cmd} exited ${code}\n${out.slice(-2000)}`))));
  });
}

export function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--") || a === "--") continue;
    const [k, v] = a.slice(2).split("=", 2);
    if (v !== undefined) args[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) args[k] = argv[++i];
    else args[k] = true;
  }
  return args;
}

/**
 * 720p review copy. Film grain is hard to compress: at low bitrates x264 smears it into
 * blotches and banding, so keep quality high and tell the encoder the source is grainy.
 */
export function proxyArgs(input: string, output: string): string[] {
  return ["-i", input, "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "medium", "-tune", "grain", "-crf", "21",
    "-maxrate", "3M", "-bufsize", "6M", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", output];
}

export async function alignNarration(audio: string, script: string, out: string) {
  await run(PYTHON, [join(REPO_DIR, "packages/align/align.py"), "--audio", audio, "--script", script, "--out", out, "--ffmpeg", FFMPEG], {
    echo: true,
  });
}
