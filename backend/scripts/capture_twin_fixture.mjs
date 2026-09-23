// Runs Person A's real in-browser SimulationEngine (src/lib/twin) under Node and records the
// UiSnapshot frames exactly as TwinPublisher would send them (JSON.stringify => Infinity -> null).
//   node backend/scripts/capture_twin_fixture.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transpileTree } from "../../web/lib/stream/test/transpile.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = path.join(root, "src/lib/twin");
const out = path.join(root, "node_modules/.cache/copilot-twin-capture");
transpileTree(fs.readdirSync(src).filter((f) => f.endsWith(".ts")).map((f) => path.join(src, f)), src, out);

const { SimulationEngine } = await import(path.join(out, "simulation.mjs"));
const { emptyInput } = await import(path.join(out, "telemetry.mjs"));
const e = new SimulationEngine();
const run = (n) => { for (let i = 0; i < n; i++) e.step(1 / 60, emptyInput()); };
const frames = [];
const grab = (label) => frames.push({ label, frame: JSON.parse(JSON.stringify({ type: "twin_snapshot", snapshot: e.snapshot() })) });

run(120); grab("idle start");
e.forceWorkerApproach(); run(600); grab("worker approach (proximity alert)");
e.forceTipOver(); run(60); grab("tip-over injected");
e.setWeather("rain"); run(30); grab("rain");
e.forceCollisionRisk(); run(60); grab("collision risk");

const dest = path.join(root, "backend/tests/fixtures/twin_snapshots.json");
fs.writeFileSync(dest, JSON.stringify({ captured_from: "src/lib/twin SimulationEngine (Person A)", frames }, null, 1));
console.log(`wrote ${path.relative(root, dest)}: ${frames.length} frames; alerts per frame:`,
  frames.map((f) => f.frame.snapshot.alerts.map((a) => a.id)));
