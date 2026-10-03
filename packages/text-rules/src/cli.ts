// pnpm check-text <file> [...files]
// Prints prime-directive violations with line numbers. Exits 1 if any errors.
import { readFileSync } from "node:fs";
import { checkText, hasErrors } from "./index";

let failed = false;
for (const file of process.argv.slice(2).filter((a) => a !== "--")) {
  const text = readFileSync(file, "utf8");
  const v = checkText(text);
  console.log(`${file}: ${v.length ? `${v.length} finding(s)` : "clean"}`);
  for (const x of v) {
    const line = text.slice(0, x.start).split("\n").length;
    const ctx = text.slice(Math.max(0, x.start - 40), x.end + 20).replace(/\s+/g, " ");
    console.log(`  ${x.severity.padEnd(7)} line ${line}: ${x.message}  …${ctx}…`);
  }
  failed ||= hasErrors(v);
}
process.exit(failed ? 1 : 0);
