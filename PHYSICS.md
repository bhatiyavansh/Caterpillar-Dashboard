# Twin physics

The local fleet runs on a Rapier rigid-body world (`@dimforge/rapier3d-compat` 0.12, WASM), in `src/lib/twin/physics/`. The world steps inside `SimulationEngine.step()` at a fixed 60 Hz, with at most 3 substeps per frame.

It only runs for locally simulated machines. With live telemetry (`source === "websocket"`) or a recorded incident replay, the world is not stepped. All bodies turn kinematic and pick up from telemetry when local simulation resumes. `MachineTelemetry` keeps the same shape and meaning.

Verify everything below with `npm run physics:check`, which writes `data/physics-check.json`.

## Ground

- **Shared grid.** `buildHeightGrid()` in `terrain.ts` samples `terrainHeight()` once on a 1 m grid (361 × 361). Both the render mesh (`Terrain.tsx`) and the collider are built from that same array.
- **Trimesh, not heightfield.** The collider is a trimesh using the same triangle split as the render mesh. Rapier's heightfield was tried first and rejected: in 0.12, rays within about 1e-4 of vertical miss a heightfield entirely, and wheel rays on level ground are exactly vertical.
- **Measured over 5,000 random vertical rays:**
  - Collider vs render mesh: 0.00002 m max.
  - Collider vs the continuous `terrainHeight()`: 0.006 m mean, 1.6 m max. The large values are at sharp feature edges, where both the mesh and the collider are sampled at 1 m.
- **Deformation is cosmetic.** Ruts are a painted wear overlay and the collider never changes. Rebuilding a 130k-triangle collider per edit costs milliseconds, for detail smaller than a grid cell.

## Landforms and colliders

| Landform | Collider |
|---|---|
| Benched pit (floor, 2 benches, rim) | ground trimesh |
| Pit ramp, 11.5% | ground trimesh |
| Pit ramp berms | ground trimesh |
| Pit ramp guardrails | ground-following cuboids |
| Waste dump and 20% tip ramp | ground trimesh |
| Dump crest berm | ground trimesh |
| Dump ramp berms | ground trimesh |
| Dump ramp guardrails | ground-following cuboids |
| Bench face C (post-failure slump plane) | ground trimesh |
| Bench face C (intact wedge) | 60 rock blocks: fixed, dynamic after failure |
| 13° sidehill bench | ground trimesh |
| Trenches and spoil ridges | ground trimesh |
| Haul-road windrows | ground trimesh |
| Stockpile and spoil mounds | ground trimesh |
| Pond basin | ground trimesh (the water plane is visual only) |
| Crusher hopper walls and house | cuboids |
| Containers, office, fuel tanks, light masts, barriers | cuboids |
| Perimeter fence | ground-following cuboids, with a gap at the gate |

The structure colliders all come from `SITE_COLLIDERS` in `site.ts`, the same list the meshes are drawn from.

Traffic cones and zone marker posts have no collider, on purpose: they are sub-metre, and a 20 t machine doesn't stop for them.

## Machines

- **Bodies.** Each machine is one dynamic body: a compound of cuboids, one per part, plus ray-cast supports (`specs.ts`). Wheels are supports on the loader and truck; roller stations under each track are supports on the excavator and dozer.
- **Masses.** Masses mirror `simulator/config.py`:

  | Machine | Mass |
  |---|---|
  | 320 excavator | 22 t |
  | D6 dozer | 23 t |
  | 950 loader | 19 t |
  | 745 truck | 30 t, plus payload |

- **Moving centre of mass.** The excavator's house, counterweight, arm, bucket and payload are applied each substep as additional mass with a moving centre of mass. That shift is what tips it.
- **Tip-over margin.** `computeTipOverMargin()` is now a display metric, fed by the physical attitude.
- **Drive.** A speed governor caps tractive force at each machine's rated pull; skid steer drives the tracked machines.
- **Traction.** At each support, traction is capped at μ·N of the ground under it. Rapier's controller halves the forward impulse before clamping it, so `frictionSlip` is set to μ/2. Brake is an impulse per step, and a wheel with any engine force ignores its brake.
- **Contact.** Machine contact comes from Rapier collision events and raises a `MACHINE CONTACT` alert. Tools that cut the ground (bucket, blade) don't collide with terrain.
- **Proximity.** A worker's distance is measured to the machine hull, using `intersectionsWithShape` and then `projectPoint`.
- **V2V braking.** Machines brake for each other using a shape cast of their own footprint, with right-of-way yielding.

## Friction by surface (`surface.ts`)

`surfaceAt()` classifies the ground, and the terrain colours use the same classes.

| Surface | Dry μ | Wet μ |
|---|---|---|
| Road | 0.85 | 0.55 |
| Packed | 0.80 | 0.50 |
| Natural | 0.70 | 0.42 |
| Rock face | 0.75 | 0.60 |
| Gravel windrow | 0.55 | 0.40 |
| Loose spoil | 0.50 | 0.16 |
| Wet clay | 0.35 | 0.15 |

Rain blends these toward the wet values as the ground soaks.

Rapier JS has no per-contact modification hooks. So vehicles get per-surface friction per wheel, while loose debris uses one wetness-scaled coefficient.

## Scenarios

A scenario is data in `physics/scenarios/library.ts`, using the types in `physics/scenarios/types.ts`:

- **`cast`**: the machines it takes over.
- **`setup`**: actions that set the site up.
- **`steps`**: each step waits for a trigger condition, then runs its actions.
- **`expect`**: outcomes the runner watches for.

The runner only sets operator inputs, places machines, sets weather and payloads, and releases the face. The physics decides the outcome.

To add a scenario, append a definition to `PHYSICS_SCENARIOS`. It then appears in the director panel and the HMI test bench.

The director's collision-risk and tip-over actions now run `dozer-intercept` and `load-shift-tipover`.

Headless outcomes (`physics:check`):

| Scenario | Outcome observed |
|---|---|
| slope-failure | Face fails at 10.0 s; excavator pitched past 10° at 12.8 s |
| load-shift-tipover | Stability alert 1.5 s; holds 4.3 s; overturns 5.9 s |
| wet-ramp-slip | Traction lost 5.4 s; slides back 2 m at 11.3 s |
| dry-ramp control | No slip, no slide |
| near-miss-v2v | Dozer stopped short at 14.4 s, no contact |
| dozer-intercept | Contact at 11.2 s |

## Frame budget

These numbers are for 4 machines, 60–80 bodies, and loose material.

| Measurement | Result |
|---|---|
| Physics step, Node (180 s of fleet traffic) | p50 0.68 ms, p95 1.13 ms |
| Whole engine step, Node | p50 1.14 ms, p95 1.80 ms |
| Physics step, browser, isolated | 0.62 ms per step |
| Deepest hull-to-hull penetration over 180 s | 0.005 m |

The deepest penetration is solver contact slop. Machines cannot occupy the same space.

That is about 4–7% of a 16.7 ms frame.

Render frame rate could not be measured in this environment. The headless browser uses SwiftShader software WebGL at about 1 fps, and there it runs 3 substeps per frame and reports higher in-frame numbers. Those figures are not representative of a GPU machine.
