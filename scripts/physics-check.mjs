/**
 * Headless physics verification: boots the real SimulationEngine with the
 * Rapier world (no renderer) and checks what the twin claims.
 *
 *   1. The ground collider is the render mesh: ray-cast the collider at
 *      random points and compare with the shared grid's triangles.
 *   2. Machines cannot occupy the same space: run the autonomous fleet and
 *      measure the deepest hull-to-hull penetration every tick.
 *   3. Frame budget: time the physics step and the whole engine step.
 *   4. Every library scenario runs to completion; report which outcomes the
 *      physics produced. The wet-ramp scenario is re-run dry as a control.
 *
 * Run: npm run physics:check   (writes data/physics-check.json)
 */
import { createJiti } from "jiti";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const jiti = createJiti(import.meta.url, { alias: { "@web": join(root, "web"), "@": join(root, "src") } });
const { SimulationEngine } = await jiti.import(join(root, "src/lib/twin/simulation.ts"));
const { emptyInput } = await jiti.import(join(root, "src/lib/twin/telemetry.ts"));
const T = await jiti.import(join(root, "src/lib/twin/terrain.ts"));
const { PHYSICS_SCENARIOS } = await jiti.import(join(root, "src/lib/twin/physics/scenarios/library.ts"));

const DT = 1 / 60;
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

async function freshEngine() {
  const e = new SimulationEngine();
  await e.enablePhysics();
  // Let the first-step WASM warm-up happen before anything is measured.
  e.step(DT, emptyInput());
  return e;
}

/* ------------------------------------------------ 1. collider vs mesh */

const e0 = await freshEngine();
const R = e0.physics.R;
const grid = T.buildHeightGrid();
let maxMesh = 0;
let maxFn = 0;
let sumFn = 0;
let misses = 0;
const N = 5000;
for (let i = 0; i < N; i++) {
  const x = (Math.random() - 0.5) * 350;
  const z = (Math.random() - 0.5) * 350;
  const hit = e0.physics.world.castRay(new R.Ray({ x, y: 200, z }, { x: 0, y: -1, z: 0 }), 400, true, undefined, undefined, undefined, undefined, (c) => c.shape.type === R.ShapeType.TriMesh);
  if (!hit) {
    misses++;
    continue;
  }
  const y = 200 - (hit.toi ?? hit.timeOfImpact);
  maxMesh = Math.max(maxMesh, Math.abs(y - T.gridHeight(grid, x, z)));
  const d = Math.abs(y - T.terrainHeight(x, z));
  maxFn = Math.max(maxFn, d);
  sumFn += d;
}
const terrain = {
  samples: N,
  misses,
  colliderVsRenderMeshMaxM: round(maxMesh, 6),
  colliderVsContinuousFnMaxM: round(maxFn),
  colliderVsContinuousFnMeanM: round(sumFn / (N - misses), 4),
};
console.log("terrain", terrain);

/* ------------------------------------- 2+3. fleet: overlap and timing */

function deepestPenetration(engine) {
  const world = engine.physics.world;
  const machines = [...engine.physics.machines.values()];
  let deepest = 0;
  let pair = null;
  for (let i = 0; i < machines.length; i++) {
    for (let j = i + 1; j < machines.length; j++) {
      for (const a of machines[i].colliders) {
        for (const b of machines[j].colliders) {
          world.contactPair(a, b, (m) => {
            for (let k = 0; k < m.numContacts(); k++) {
              const d = -m.contactDist(k);
              if (d > deepest) {
                deepest = d;
                pair = `${machines[i].id}/${machines[j].id}`;
              }
            }
          });
        }
      }
    }
  }
  return { deepest, pair };
}

const fleetSeconds = 180;
const e1 = await freshEngine();
const physMs = [];
const engineMs = [];
let worst = { deepest: 0, pair: null };
let contacts = 0;
for (let i = 0; i < fleetSeconds * 60; i++) {
  const t0 = performance.now();
  e1.step(DT, emptyInput());
  engineMs.push(performance.now() - t0);
  physMs.push(e1.physics.stats.lastStepMs);
  const p = deepestPenetration(e1);
  if (p.deepest > worst.deepest) worst = p;
  contacts = Math.max(contacts, e1.physics.touching.size);
}
const fleet = {
  simulatedSeconds: fleetSeconds,
  machines: e1.physics.machines.size,
  materialParcels: e1.physics.material.count,
  deepestHullPenetrationM: round(worst.deepest, 4),
  deepestPair: worst.pair,
  physicsStepMs: { p50: round(pct(physMs, 0.5)), p95: round(pct(physMs, 0.95)), max: round(Math.max(...physMs)) },
  engineStepMs: { p50: round(pct(engineMs, 0.5)), p95: round(pct(engineMs, 0.95)), max: round(Math.max(...engineMs)) },
};
console.log("fleet", fleet);

/* ------------------------------------------------------ 4. scenarios */

async function runScenario(def) {
  const e = await freshEngine();
  e.scenarios.start(def, e);
  const physMs = [];
  let bodiesAwake = 0;
  let steps = 0;
  while (e.scenarios.running && steps < def.timeoutS * 60 + 120) {
    e.step(DT, emptyInput());
    physMs.push(e.physics.stats.lastStepMs);
    bodiesAwake = Math.max(bodiesAwake, e.physics.stats.awake);
    steps++;
  }
  const st = e.scenarios.status();
  return {
    id: def.id,
    ranSeconds: round(steps * DT, 1),
    outcomes: st.met.map((m) => ({ label: m.label, observedAtS: m.at === null ? null : round(m.at, 1) })),
    physicsStepMs: { p50: round(pct(physMs, 0.5)), p95: round(pct(physMs, 0.95)), max: round(Math.max(...physMs)) },
    peakAwakeBodies: bodiesAwake,
  };
}

const scenarios = [];
for (const def of PHYSICS_SCENARIOS) {
  const r = await runScenario(def);
  scenarios.push(r);
  console.log("scenario", r.id, JSON.stringify(r.outcomes), "p95", r.physicsStepMs.p95, "ms");
}

// Control: the same truck, the same ramp, dry.
const wet = PHYSICS_SCENARIOS.find((s) => s.id === "wet-ramp-slip");
const dry = {
  ...wet,
  id: "dry-ramp-control",
  setup: wet.setup.filter((a) => a.kind !== "soak" && a.kind !== "weather").concat([{ kind: "weather", mode: "clear" }]),
};
const control = await runScenario(dry);
console.log("control", control.id, JSON.stringify(control.outcomes));

/* ----------------------------------------------------------- verdict */

const failures = [];
if (terrain.misses > 0) failures.push(`${terrain.misses} ground rays missed the collider`);
if (terrain.colliderVsRenderMeshMaxM > 0.001) failures.push("collider diverges from the render mesh");
if (fleet.deepestHullPenetrationM > 0.15) failures.push(`machines interpenetrated by ${fleet.deepestHullPenetrationM} m (${fleet.deepestPair})`);
const outcome = (id, label) => scenarios.find((s) => s.id === id)?.outcomes.find((o) => o.label === label)?.observedAtS ?? null;
if (outcome("slope-failure", "Face fails under load") === null) failures.push("slope failure: face never failed");
if (outcome("load-shift-tipover", "Machine overturns") === null) failures.push("load shift: machine did not overturn");
if (outcome("wet-ramp-slip", "Truck slides back 2 m") === null) failures.push("wet ramp: truck did not slide back");
if (control.outcomes.find((o) => o.label === "Truck slides back 2 m")?.observedAtS !== null) failures.push("dry control: truck slid on a dry ramp");
if (outcome("near-miss-v2v", "Contact (should not happen)") !== null) failures.push("near miss: V2V failed, machines touched");
if (outcome("dozer-intercept", "Machines make contact") === null) failures.push("intercept: no contact");

const report = { generatedAt: new Date().toISOString(), terrain, fleet, scenarios, control, failures };
mkdirSync(join(root, "data"), { recursive: true });
writeFileSync(join(root, "data", "physics-check.json"), JSON.stringify(report, null, 2));
if (failures.length) {
  console.error("FAIL\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("PASS — data/physics-check.json");
