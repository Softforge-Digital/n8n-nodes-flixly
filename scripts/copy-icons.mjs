// Copies node icons (.svg) from source dirs to the built dist/ tree so
// n8n's loader can find them next to the compiled .node.js files.
//
// We don't use gulp here — too much overhead for one cp -r equivalent.
// Native fs.cpSync (Node 16.7+) does the job in three lines.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";

const SRC = "nodes";
const DEST = "dist/nodes";

function walk(dir, callback) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, callback);
    } else {
      callback(full);
    }
  }
}

walk(SRC, (file) => {
  if (!file.endsWith(".svg") && !file.endsWith(".png")) return;
  const rel = relative(SRC, file);
  const target = join(DEST, rel);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);
  console.log(`[icons] ${file} -> ${target}`);
});
