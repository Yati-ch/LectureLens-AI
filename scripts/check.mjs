import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["server.mjs", "lib", "public", "test", "scripts"];
const files = [];

function collect(entry) {
  const target = path.join(root, entry);
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (target.endsWith(".mjs")) files.push(target);
    return;
  }
  for (const child of fs.readdirSync(target)) {
    collect(path.join(entry, child));
  }
}

for (const entry of roots) collect(entry);
for (const file of [...new Set(files)].sort()) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
  console.log(`✓ ${path.relative(root, file)}`);
}
console.log(`Checked ${new Set(files).size} JavaScript modules.`);
