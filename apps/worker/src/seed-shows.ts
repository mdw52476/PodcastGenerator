// pnpm shows:seed
// Upserts the show profiles in fixtures/shows/*.json into the `shows` table, and
// fills in an episode's script from its plan's script file when it has none yet.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ShowProfile } from "@shoebox/edit-plan";
import { REPO_DIR } from "@shoebox/engine/pipeline";
import { db } from "./supabase";

const dir = join(REPO_DIR, "fixtures/shows");
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  const id = f.replace(/\.json$/, "");
  const profile = ShowProfile.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));
  const { error } = await db().from("shows").upsert({ id, name: profile.name, profile });
  if (error) throw error;
  console.log(`show ${id}: ${profile.name}`);
}

// EP01's script comes from the fixture's voiceover file.
const { data: ep } = await db().from("episodes").select("id, script").eq("id", "ep01-test").maybeSingle();
if (ep && !ep.script) {
  const script = readFileSync(join(REPO_DIR, "fixtures/ep01/ep01-voiceover-v2.txt"), "utf8");
  const { error } = await db().from("episodes").update({ script }).eq("id", ep.id);
  if (error) throw error;
  console.log(`episode ${ep.id}: script filled in (${script.length} characters)`);
}
