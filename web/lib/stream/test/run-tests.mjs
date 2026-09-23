// Node test runner for web/lib/{stream,assistant}: transpile TS -> .mjs into node_modules/.cache (so bare imports
// like "zustand/vanilla" resolve from the repo's node_modules), then run `node --test`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transpileTree } from "./transpile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const webLib = path.resolve(here, "../..");            // web/lib
const root = path.resolve(webLib, "../..");
const out = path.join(root, "node_modules/.cache/copilot-weblib-test");
fs.rmSync(out, { recursive: true, force: true });
const packages = ["stream", "assistant"];
const files = [];
for (const pkg of packages) {
  const dir = path.join(webLib, pkg);
  files.push(...fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "hooks.ts" && f !== "index.ts").map((f) => path.join(dir, f)));
  const t = path.join(dir, "test");
  if (fs.existsSync(t)) files.push(...fs.readdirSync(t).filter((f) => f.endsWith(".test.ts")).map((f) => path.join(t, f)));
}
transpileTree(files, webLib, out);
const tests = packages.flatMap((pkg) => {
  const t = path.join(out, pkg, "test");
  return fs.existsSync(t) ? fs.readdirSync(t).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join(t, f)) : [];
});
const r = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(r.status ?? 1);
