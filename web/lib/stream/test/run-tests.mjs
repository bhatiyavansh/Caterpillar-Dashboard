// Node test runner for web/lib/stream: transpile TS -> .mjs into node_modules/.cache (so bare imports
// like "zustand/vanilla" resolve from the repo's node_modules), then run `node --test`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transpileTree } from "./transpile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.resolve(here, "..");
const root = path.resolve(lib, "../../..");
const out = path.join(root, "node_modules/.cache/copilot-stream-test");
fs.rmSync(out, { recursive: true, force: true });
const files = [
  ...fs.readdirSync(lib).filter((f) => f.endsWith(".ts") && f !== "hooks.ts").map((f) => path.join(lib, f)),
  ...fs.readdirSync(here).filter((f) => f.endsWith(".test.ts")).map((f) => path.join(here, f)),
];
transpileTree(files, lib, out);
const tests = fs.readdirSync(path.join(out, "test")).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join(out, "test", f));
const r = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(r.status ?? 1);
