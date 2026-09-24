# CAT Copilot — Design Reference

What the product looks like and is built of, as of this snapshot. This is a
reference for designers, for briefing external tools (Stitch, Figma, v0), and
for anyone picking the codebase up cold. It describes the current state, not
the roadmap — see `VISION.md` for where this is going.

---

## 1. Visual language

**Industrial, not SaaS.** Near-black charcoal surfaces, CAT-inspired yellow
reserved for action, and colour that is never the only signal — every status
carries an icon and an uppercase label alongside its colour. Flat panels, thin
borders, no gradients, no glassmorphism, no decorative illustration.

### Palette

| Token | Hex | Use |
|---|---|---|
| `catYellow` | `#FFCD11` | Primary action, active selection, CAT paint |
| `catYellowDark` | `#D9A800` | Pressed/secondary yellow, worn paint |
| Surface 950 | `#0B0C0E` | App background |
| Surface 900 | `#15171A` | Panels |
| Surface 800 | `#1E2125` | Cards, raised panels |
| Border | `#2A2E33` | 1px hairlines |
| `steel` / `steelDark` / `steelLight` | `#2B3036` / `#1A1D21` / `#454D55` | Machine frames, structural metal |
| `glass` | `#8FC4E8` | Cab glazing |
| `safe` | `#3DDC84` | Green — normal / safe |
| `warn` | `#FFB020` | Amber — caution |
| `crit` | `#FF3B30` | Red — critical |
| info blue | `#5AA0D6` | Informational |

Terrain/material palette (3D twin only — see §4):
`gravel #A29682`, `topsoil #6E5236`, `scrub #5C6532`, `clay #54402E`,
`strataLight #B89468` / `strataDark #5A3F2B`, `water #3F5E5A`,
`concrete #A9A59B`.

### Type

- **Inter** — UI text.
- **JetBrains Mono** (or system tabular mono) — telemetry numbers, IDs.
- Section headers: uppercase, `letter-spacing: 0.12em`, small size, muted colour.
- Live values: large, tabular-nums, high contrast against the panel.

### Layout rules

- Rounded corners 6–8px. No pill-shaped cards.
- Panels are flat with a 1px border, not drop shadows.
- Real-looking data everywhere: machine IDs like `EXC001`, `TRK003`;
  operators like "Meera Nair"; units always shown (`km/h`, `°C`, `kg`, `%`).
- Touch targets in the cab/machine UI are ≥48px, primary actions ≥56px.

---

## 2. Two products, one state

| | **Dashboard** | **Machine application** |
|---|---|---|
| Audience | Supervisors, fleet managers, service engineers | The operator in the cab |
| Density | Information-dense, tables and charts | Minimal, read-at-a-glance |
| Input | Mouse/keyboard, desktop widths | Touch, 48–56px+ targets, landscape |
| Route | `/dashboard` | `/machine`, `/cab`, or inside the simulator |

Both read the same Zustand-backed machine state (`src/store/machine-store.ts`
for the legacy mock model; `web/lib/stream` + `src/lib/api` for the
live-backend-aware product surfaces), so a warning raised in the cab is
visible to the supervisor immediately, live or mocked.

---

## 3. Screen inventory

**Dashboard** (supervisor-facing): `/dashboard`, `/dashboard/fleet`,
`/dashboard/machines`, `/dashboard/machines/[id]`, `/dashboard/live`,
`/dashboard/maintenance`, `/dashboard/diagnostics`, `/dashboard/tasks`,
`/dashboard/alerts`, `/dashboard/reports`, `/dashboard/settings`.

**Machine / in-cab HMI**: `/machine`, `/machine/assistant`,
`/machine/inspection`, `/machine/alerts`, `/machine/camera`, `/machine/map`,
`/machine/performance`, `/machine/status`, `/machine/operator`,
`/machine/notifications`.

**Product surfaces (P2 build)**: `/cab` (operator HMI + AI assistant),
`/command` (3D site command centre), `/owner` (fleet insights portal),
`/training` (training hub), `/ar` (AR maintenance), `/director` (hidden
demo-scenario trigger panel).

**Simulation / twin**: `/simulation` (rugged in-cab display emulator,
true device resolutions), `/twin` (standalone 3D digital twin).

**Dev**: `/dev/avatar`, `/dev/stream`, `/dev/local-control`.

---

## 4. The 3D digital twin

The most visually complex surface, and the one most recently reworked end to
end (terrain, fleet, machine models — see `src/lib/twin/` and
`src/components/twin/`).

### Site

- **Single source of truth:** `src/lib/twin/site.ts`. The layout is not
  invented — it's the backend simulator's own site (`simulator/site.py`)
  translated into twin coordinates (`fromSim(x, y)`), so a machine the live
  feed reports "at the loader point" is standing at the loader point in 3D.
- **Terrain** (`src/lib/twin/terrain.ts`): procedural, one function
  (`terrainHeight(x, z)`) is the single source of ground height for both the
  rendered mesh and the vehicle physics, so they can never disagree.
  - A benched excavation pit (4 levels, 10m deep) with rock-strata cut faces.
  - A raised waste-dump tip head trucks drive up onto and reverse off.
  - Trenches with spoil windrowed alongside, at a progress-driven dig length.
  - Stockpiles shaped as real cones at their angle of repose.
  - Haul roads cut/filled to grade, with safety windrows (berms) down the
    shoulders, opened at every junction.
  - Valley walls and forested hills rising around the whole 700m terrain,
    fading into a distant mountain ring so there's no visible edge of world.
- **Props** (`src/components/twin/SiteProps.tsx`, `SiteDetails.tsx`):
  crusher plant with a running conveyor, sediment pond with a floating pump,
  perimeter fence + gate with a lifting boom barrier, site compound
  (portacabins, parked pickups, muster point, water tank, windsock), power
  line, stacked stores (concrete pipes, pallets, jersey barriers), and
  hundreds of instanced rocks/scrub/trees kept clear of every road, pad and
  live haul lane.

### Fleet

Nine machines, matching the backend roster exactly
(`simulator/config.py` FLEET):

| ID | Kind | Role |
|---|---|---|
| EXC001 | Excavator (CAT 320) | Operator-controlled ("hero" machine) |
| EXC002 | Excavator (CAT 320) | Autonomous pit excavation |
| WHL001 | Wheel loader (CAT 950) | Digs stockpile, loads trucks |
| DOZ001 | Dozer (CAT D6) | Pushes lanes across the pit floor |
| GRD001 | Grader (CAT 140) | Passes across zone C |
| TRK001–004 | Haul truck (CAT 745) | Queue → load → haul → tip → return |

When no backend is attached, `src/lib/twin/fleet.ts` drives all of this
locally: dig-cycle keyframes for the excavator, a Z-bar loader linkage that
keeps the bucket level as it lifts, truck queueing with car-following
distance, and machines that interact (a truck only leaves once loaded, the
loader waits with a full bucket if no truck is spotted). Everything drives
through the same `VehicleModel` integrator the keyboard-controlled machine
uses, so the whole fleet accelerates, labours up ramps and leans into turns
identically.

### Machine models (`src/components/twin/rig.tsx` + one file per kind)

- Shared rig: one material set for the whole fleet, a `<Ram>` component that
  stays pinned between two anchors and extends/retracts as a linkage moves
  (the core of what makes hydraulics look mechanical), tread-textured tyres,
  scrolling track-shoe textures, CAT decals, flashing beacons, reversing
  lights.
- `Excavator.tsx`, `Truck.tsx`, `Loader.tsx`, `Bulldozer.tsx`, `Grader.tsx` —
  each with a real linkage (twin boom rams, articulated steering, Z-bar
  lift arms, high-drive track triangle, drawbar-and-circle moldboard).

### Cameras (`src/components/twin/CameraController.tsx`)

Six modes: **Follow** (rides behind the selected machine, user keeps
orbit/zoom), **Chase** (low, close, swings with heading), **Orbit** (slow
cinematic circle), **Top down**, **Site** (three-quarter fleet overview),
**Driver** (in-seat, per-machine eye point and look target).

---

## 5. Component conventions

- `src/components/ui/` — shadcn-style primitives on Radix (button, card,
  badge, dialog, tabs, slider, switch).
- `src/components/gauges/` — SVG sensor gauges and bar gauges.
- `src/components/charts/` — Recharts wrappers with the shared industrial
  theme (see the `dataviz` skill for the palette/contrast rules these follow).
- Status colour is always paired with an icon + uppercase text label —
  enforced convention, not just a guideline (`MachineStatusChip`,
  `StatusDot`, alert ribbons all do this).

---

## 6. Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
shadcn-style primitives on Radix · Motion · Recharts · Zustand · Lucide ·
React Three Fiber + Three.js + drei (3D twin) · FastAPI backend (Python) ·
WebSocket telemetry hub.

---

## 7. Where to look for more

- `README.md` — running the app, project structure, demo flow.
- `VISION.md` — the full product vision, features, architecture (beyond this build).
- `HANDOFF.md` / `PERSON_C.md` — team-specific working notes.
- `src/lib/twin/site.ts` — the site layout, annotated.
- `src/components/twin/materials.ts` — the full colour palette and procedural textures.
