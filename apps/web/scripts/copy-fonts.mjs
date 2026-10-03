// The preview player loads the same bundled OFL fonts as the renderer (staticFile("fonts/...")).
import { cpSync } from "node:fs";
cpSync("../../packages/engine/public/fonts", "public/fonts", { recursive: true });
