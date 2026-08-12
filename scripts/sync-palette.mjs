// Copies the generated shell palette from chrysaki-core into palette/.
// The copy is committed so the statusline runs without node at render time.
// Usage: node scripts/sync-palette.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "@kiriketsuki", "chrysaki-core", "dist", "chrysaki.sh");
const dst = join(root, "palette", "chrysaki-core.sh");

const wanted = readFileSync(src, "utf8");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(dst, "utf8");
  } catch {
    // A missing copy fails the check below.
  }
  if (current !== wanted) {
    console.error("palette/chrysaki-core.sh is stale. Run: npm run sync-palette");
    process.exit(1);
  }
  console.log("palette/chrysaki-core.sh matches chrysaki-core.");
} else {
  writeFileSync(dst, wanted);
  console.log("Wrote palette/chrysaki-core.sh from chrysaki-core.");
}
