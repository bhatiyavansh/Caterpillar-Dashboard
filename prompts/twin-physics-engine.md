# Cloud task: real physics engine + realistic landsite for the CAT Copilot digital twin

## Context (read this first, don't re-derive it)

This is `cat-copilot` — a Next.js 16 / React 19 / R3F digital twin of a
quarry site with 9 CAT machines. The twin already has:

- **Site layout** — `src/lib/twin/site.ts`. Single source of truth (roads,
  zones, pit geometry, waypoints), translated 1:1 from the backend
  simulator's own coordinates (`simulator/site.py`, `fromSim(x, y)`).
- **Terrain** — `src/lib/twin/terrain.ts`. One function, `terrainHeight(x, z)`,
  procedurally generates a benched pit, a raised waste-dump, trenches,
  stockpile cones, cut/fill roads with windrows, and valley walls, all as
  pure math (noise + SDFs), sampled both by the render mesh
  (`src/components/twin/Terrain.tsx`) and by the vehicle attitude sampler
  (`sampleAttitude`), so visuals and physics can't disagree.
- **Vehicle model** — `src/lib/twin/vehicle.ts`. `VehicleModel.step()` is a
  **hand-tuned kinematic integrator**, not a physics engine: speed/yaw are
  damped toward targets, attitude comes from sampling 4 ground points under
  the chassis. No mass, no real forces, no inertia tensor, no actual
  rigid-body contact resolution between machines.
- **Fleet AI** — `src/lib/twin/fleet.ts`. Keyframed/scripted behaviour
  per role (excavator dig cycle, loader Z-bar lift, truck queue/haul/tip,
  dozer lanes, grader passes) driving `VehicleModel` inputs. Machines avoid
  collision only via a car-following throttle limiter — there is **no real
  collision physics** between vehicles, between a vehicle and terrain
  obstacles, or for loose material (spoil, dumped loads, bucket contents).
- **Machine rig** — `src/components/twin/rig.tsx` + `Excavator.tsx`,
  `Truck.tsx`, `Loader.tsx`, `Bulldozer.tsx`, `Grader.tsx`. Pure
  transform-from-telemetry components — no physics awareness at all, they
  just read `MachineTelemetry` and set transforms.
- **`@dimforge/rapier3d-compat` is already a dependency** (`package.json`)
  but is currently **unused anywhere in the codebase** — it was pulled in
  for a planned browser training mini-simulator (see `VISION.md` §4.6,
  §"training mini-sim") and never wired up. This is the obvious physics
  engine to adopt rather than introducing a second one.
- **Live/mock duality** — `src/lib/twin/websocketProvider.ts` overlays real
  backend telemetry onto the same `MachineTelemetry` objects the local
  fleet AI writes to, at ~1Hz, eased. Physics changes must not break this:
  when a backend is attached, its telemetry is authority for position/pose;
  local physics only runs when `source !== "websocket"`.
- **Design reference** — `DESIGN.md` has the full visual language, palette,
  and site/fleet inventory. Read it before touching visuals.
- Full architecture notes: `src/lib/twin/site.ts`, `terrain.ts`, `fleet.ts`,
  `vehicle.ts` are all heavily commented — read those file headers before
  changing them.

## The ask

Replace the current kinematic approximation with **a real physics
simulation** driving all 9 machines, so the digital twin supports genuine
multi-body interaction and can run arbitrary real-world scenarios, not just
the scripted dig/haul loop it runs today.

### 1. Adopt Rapier as the physics engine

- Wire up `@dimforge/rapier3d-compat` as the twin's physics world, stepped
  inside `SimulationEngine.step()` (`src/lib/twin/simulation.ts`) alongside
  (not replacing) the existing telemetry tick, so the WebSocket live-mode
  path is untouched.
- Each machine gets a real rigid body: correct mass (per `simulator/config.py`
  `MachineSpec` — reuse those masses, don't invent new ones), an approximate
  convex collider per major part (chassis, tracks/wheels as separate bodies
  or compound shapes), and real inertia.
- Terrain becomes a **static trimesh collider** generated from the exact
  same `terrainHeight()` grid the visual mesh uses (share the geometry
  build, don't regenerate it twice) — this is what keeps physics and
  visuals from drifting apart, same principle as the current
  `sampleAttitude` approach.
- Drivetrain forces (engine torque, braking, steering, track/tyre friction)
  replace the current `damp()`-toward-target approach in `vehicle.ts`.
  Keep the public `MachineTelemetry` contract identical — downstream
  consumers (HUD, alerts, the whole rest of the app) must not need to
  change.

### 2. Real multi-vehicle interaction

- Actual rigid-body contact resolution between machines — two trucks
  queuing nose-to-tail should be able to *nudge*, not just stop at a
  scripted gap. Remove or backstop the current `followLimit()` throttle
  hack in `fleet.ts` with real contact response.
- Loose material physics: bucket loads, tipped truck loads, dozer-pushed
  spoil should be simulated as actual rigid/soft bodies (or a cheap
  particle-pile approximation) that pile up realistically on the terrain
  trimesh, rather than the current cosmetic mesh-scaling.
- Worker/vehicle proximity should use the physics world's own
  broadphase/narrowphase instead of the current manual `Math.hypot`
  distance checks in `proximity.ts` — keep the existing `ProximityResult`
  contract so the safety bubble UI doesn't change.
- Machines should be physically unable to occupy the same space (currently
  nothing stops it — verify this is actually fixed, not just "risk
  detected").

### 3. Realistic scenario simulation

Build a scenario layer on top of the physics world that can express real
operational events, not just the current fixed dig/haul loop:

- **Slope failure / unstable ground** — a section of the pit wall
  physically gives way (dynamic rigid bodies breaking free from the
  terrain trimesh) if a machine works too close to an over-steep face.
- **Load-shift / tip-over** — an overloaded or badly-slung bucket load
  should physically destabilize the machine through the actual rigid-body
  dynamics (real centre-of-mass shift), not the current hand-written
  `computeTipOverMargin()` formula. Keep that formula as a *display/alert*
  metric fed by the physics state, not as the thing that decides physics.
- **Weather-driven traction** — rain should reduce real contact friction
  coefficients (Rapier supports per-contact friction), so wheels/tracks
  can actually slip on the ramp grades that already exist in the terrain
  (the pit ramp and dump ramp are already graded for this — verify them
  under low friction).
- **Collision/near-miss scenarios** — the existing director-panel forced
  scenarios (`forceCollisionRisk`, `forceTipOver`, etc. in
  `simulation.ts`) should produce real physical outcomes when pushed far
  enough, not just alert-state flags.
- Scenarios must be data-driven (a scenario definition format), not
  one-off hardcoded functions, so new "real life scenarios" can be added
  without touching the engine.

### 4. Landsite: make it richer and simulation-ready

The current terrain (`terrain.ts`, `Terrain.tsx`, `SiteDetails.tsx`) has a
benched pit, dump, trenches, stockpiles, roads with windrows, a crusher,
pond, fence/gate, compound, and hills — see `DESIGN.md` §4 for the full
current inventory. Extend it so it's not just visually detailed but
**physically simulatable**:

- Every landform that visuals already model (benches, ramps, windrows,
  stockpile cones, trench spoil) needs a matching physics collider — audit
  for anything currently visual-only that a machine could physically drive
  through.
- Deformable ground is a stretch goal, not a requirement: if full terrain
  deformation (wheel ruts that actually change the collider) is too
  expensive, a convincing approximation is acceptable — flag which
  approach you took and why.
- Add whatever additional real-quarry landforms make more scenarios
  possible: a second, shallower pit face for slope-failure demos; a proper
  ramp with a guardrail on the drop side; a wider variety of ground
  friction zones (wet clay near the pond, loose gravel on windrows, packed
  pads) already exist in the colour data (`materials.ts` / `Terrain.tsx`
  surface classification) — wire those same zones into physics friction
  coefficients instead of inventing a parallel system.

### 5. Performance

- Must hold 60fps with all 9 machines, their loads, and any active
  scenario debris on mid-range hardware. Rapier runs in WASM — profile
  the physics step separately from the render loop.
- The terrain trimesh collider is the biggest single cost — investigate
  whether a lower-resolution physics-only heightfield (Rapier supports
  heightfield colliders directly, which are much cheaper than a trimesh)
  is more appropriate than reusing the full visual-resolution mesh. Prefer
  a heightfield if it doesn't visibly diverge from the render mesh at
  vehicle contact points.

### 6. Click-to-inspect: machine X-ray, anomaly drill-down, fix + report generation

Right now an anomaly or alert is a row in a list (`Anomaly` in
`src/lib/api/contracts.ts`, machine health scores in
`intelligence/maintenance.py` `COMPONENTS`) with no path from "here's a
problem" to "show me where on the machine, let me act on it." Close that
loop:

- **X-ray view.** Clicking a machine in the 3D twin, or clicking straight
  through from an anomaly/alert card anywhere in the app (fleet list,
  owner portal anomaly table, maintenance forecast row), switches that
  machine's model to an X-ray render: body panels go semi-transparent,
  the internal assemblies relevant to the flagged issue stay opaque and
  highlighted — hydraulic pump/lines for a hydraulic anomaly, the
  undercarriage/track for a stability or drivetrain issue, the engine
  bay for a temperature or fuel anomaly, the specific boom/stick/bucket
  ram for an arm-related fault. Build this as a shader/material swap on
  the existing rig components (`rig.tsx` `MAT` materials, per-part meshes
  in `Excavator.tsx` / `Truck.tsx` / etc.) — not a second model. Reuse the
  camera controller's existing per-machine framing (§ camera modes in
  `CameraController.tsx`) to auto-frame the flagged component when the
  X-ray opens.
- **Component click targets.** Every major assembly already exists as a
  distinct mesh in the rig components (tracks, house, boom/stick/bucket
  and their rams, cab, engine bay, counterweight, tyres, hitch, dump body,
  lift arms, moldboard — see `rig.tsx` and each machine file). Make each
  one individually clickable (R3F `onClick` / raycasting, which the twin
  doesn't currently use anywhere — this is new) and show a small
  component-status popover on click: current reading if there's live
  telemetry backing it (e.g. hydraulic temp for the pump), health % from
  `intelligence/maintenance.py` `COMPONENTS` if it maps to one of the
  three tracked components (hydraulic_pump, engine, undercarriage), and
  any open anomaly/alert tied to that part.
- **From click to fix.** The popover's action isn't just "view" — wire it
  to the agent's existing action tools instead of inventing new ones:
  `incident_prepare` / `incident_execute` and `wo_prepare` /
  `wo_execute` in `backend/copilot/agent/tools/definitions.py` already
  implement prepare→confirm→execute for exactly this (logging an
  incident, raising a work order). The click flow should be: component
  clicked → relevant anomaly/fault context assembled (machine id,
  component, current reading, deviation from baseline) → call the
  existing `wo_prepare`/`incident_prepare` tool with that context
  pre-filled → show the draft for confirmation → `execute` on confirm.
  Don't build a parallel report-drafting path; the LLM-drafted,
  grounding-checked, template-fallback pattern in
  `backend/copilot/reports/service.py` already exists for this — reuse it.
- **Report generation.** The confirmed work order / incident should
  produce the same drafted-document artifact the rest of the system
  already generates (`reports/service.py`'s facts → structured LLM draft
  → schema+grounding validation → template fallback pattern), tagged
  with which component and which 3D view it came from, so a supervisor
  opening the report later can jump straight back to the same X-ray view
  of the same component.
- **Where this is triggered from.** Not just inside the 3D twin — an
  anomaly row anywhere in the product (owner portal anomaly table, fleet
  list alert badge, cab alert ribbon) should deep-link into this same
  X-ray + component view, i.e. one shared `openXray(machineId,
  componentId?)` entry point in the twin store
  (`src/store/twinStore.ts`), not a twin-only feature.

## Constraints — don't break these

- `MachineTelemetry` (`src/types/twin.ts`) stays the contract every other
  component reads. Whatever changes internally, the shape and meaning of
  its fields (`x, y, z, heading, pitch, roll, boomAngle, ...`) must not
  change, or you break every consumer (HUD, safety bubble, camera
  controller, all 5 machine rig components).
- Live WebSocket mode (`source === "websocket"`) must keep working exactly
  as now — physics only drives the local/mock fleet. Don't make the live
  path depend on the physics world existing.
- The 3-tier store split in `src/store/twinStore.ts` (non-reactive
  `engine` mutated in `useFrame`, throttled `snapshot` for the HUD) must be
  preserved — physics state lives in the engine tier, never in React state.
- Keep the "one ground function" principle: whatever the physics collider
  is built from, it must be derived from `terrainHeight()`, never a second
  independent definition of the ground.
- No behavioural regression in the existing director-panel demo scenarios
  (`src/components/twin/DirectorPanel.tsx`) — they need to still trigger
  correctly, now with real physical outcomes instead of scripted ones.

## Deliverables

1. Rapier physics world integrated into `SimulationEngine`, stepped
   alongside the existing tick, driving all 9 machines' rigid bodies.
2. Real inter-vehicle collision/contact response, replacing the
   throttle-limiter hack.
3. At least 3 working data-driven scenarios beyond the current dig/haul
   loop (pick from: slope failure, tip-over from load shift, wet-weather
   traction loss, a genuine near-miss with real physical avoidance/impact).
4. Terrain physics collider(s) matching every driveable/collidable
   landform, built from `terrainHeight()`.
5. A short `PHYSICS.md` documenting: the collider strategy per machine and
   per landform, the friction-zone mapping, how scenarios are authored,
   and measured frame budget for the physics step at 9 machines.
6. Updated `DESIGN.md` §4 reflecting whatever changed in the landsite.
7. X-ray view working on all 5 machine kinds, triggerable both from inside
   the twin (click a machine or a component) and from any anomaly/alert
   surface elsewhere in the app, wired through to a real
   `wo_prepare`/`incident_prepare` → confirm → `execute` → generated report
   flow (no parallel/mocked reporting path).
8. `npx tsc --noEmit` and `npx eslint src` clean. Verify visually with a
   headless screenshot pass (there's a working pattern for this earlier in
   the session history — Edge headless with `--use-angle=swiftshader`) from
   at least: site overview, a scenario mid-execution, two machines in
   contact/near-miss, and one machine in X-ray with a component popover open.

Do not scope this down silently. If something here is genuinely not
achievable at real-time framerate, say so explicitly with the measured
numbers, propose the closest achievable alternative, and implement that —
don't quietly drop it.
