# CAT Visual Assist

A production-quality prototype of a visual assistant ecosystem for heavy construction and mining equipment — excavators, wheel loaders, dozers and soil compactors.

It is two deliberately different products sharing one client-side machine state:

| | **Dashboard** | **Machine application** |
|---|---|---|
| Audience | Supervisors, fleet managers, service engineers | The operator in the cab |
| Density | Information dense, tables and charts | Minimal, read-at-a-glance |
| Input | Mouse and keyboard, desktop widths | Touch, 48–56 px+ targets, landscape displays |
| Route | `/dashboard` | `/machine`, or inside the simulator |

All data is mocked. There is no backend.

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:3000> — the root redirects to `/dashboard`.

```bash
npm run build     # production build
npx tsc --noEmit  # type check
npx eslint src    # lint
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn-style primitives on Radix · Motion · Recharts · Zustand · Lucide.

## The demo flow

1. Open `/dashboard` — fleet overview with live counters.
2. Press **RUN SIMULATION** (top right of every dashboard page).
3. A rugged in-cab display opens: industrial bezel, physical side keys, glass reflection, `SIMULATION MODE` label.
4. Sensor values update continuously — temperature drifts, fuel burns down, RPM fluctuates.
5. Open **Machine Assistant** → "Your machine is ready for operation."
6. Start the **daily inspection** and step through engine, hydraulics, tracks, fluids and safety.
7. Open the hidden **Controls** panel (top right of the simulation bar) and switch the scenario to **Warning** or **Critical**.
8. Hydraulic and engine temperatures climb; the cab alert screen and assistant advisories change severity.
9. Exit the simulation — the dashboard overview, fleet list, alerts page and diagnostics all reflect the same machine state.

`Esc` also exits the simulation. The same stage is available as a standalone route at `/simulation`.

## Simulated display sizes

The machine UI renders at true device resolution inside the frame and is then scaled to fit, so breakpoints behave as they would on real hardware:

- 1280 × 800 (primary)
- 1024 × 600
- 1280 × 720
- 1920 × 1080

## Routes

**Dashboard** — `/dashboard`, `/dashboard/fleet`, `/dashboard/machines`, `/dashboard/machines/[id]`, `/dashboard/live`, `/dashboard/maintenance`, `/dashboard/diagnostics`, `/dashboard/tasks`, `/dashboard/alerts`, `/dashboard/reports`, `/dashboard/settings`

**Machine** — `/machine`, `/machine/assistant`, `/machine/inspection`, `/machine/alerts`, `/machine/camera`, `/machine/map`, `/machine/performance`, `/machine/status`, `/machine/operator`, `/machine/notifications`

**Simulation** — `/simulation`

## Project structure

```
src/
  app/                      routes (dashboard, machine, simulation)
  components/
    alerts, assistant       (folded into machine/screens)
    charts/                 Recharts wrappers with a shared industrial theme
    dashboard/              metric cards, machine cards and table, timeline
    gauges/                 SVG sensor gauges and bar gauges
    machine/                in-cab app shell, visualization, touch primitives
      screens/              home, assistant, inspection, alerts, camera, map,
                            performance, status, operator, notifications
    navigation/             sidebar, dashboard shell, page header
    shared/                 status indicators
    simulation/             display frame, stage, presenter controls, heartbeat
    ui/                     button, card, badge, dialog, tabs, slider, switch…
  lib/
    mock-data.ts            every mock machine, alert, work order, task…
    advice.ts               sensor readings → assistant statements
    types.ts, utils.ts
  store/
    machine-store.ts        the shared mock machine state (Zustand)
    use-sensor-history.ts   rolling telemetry window for live charts
```

## Design notes

- **Industrial, not SaaS.** Near-black charcoal surfaces, CAT-inspired yellow for action, green/amber/red/blue reserved for state. Flat panels, thin borders, no decorative gradients.
- **Colour is never the only signal.** Every status carries an icon and an uppercase label alongside its colour.
- **Touch first in the cab.** Controls are at least 48 px, primary actions 56 px+, with generous spacing for gloved hands.
- **Restrained motion.** Values ease rather than snap, alerts fade in, gauges spring. `prefers-reduced-motion` disables all of it.
- **One source of truth.** The dashboard and the in-cab app read the same Zustand store, so a warning raised in the cab is visible to the supervisor immediately.

## Presenter controls

Inside the simulation, **Controls** (hidden by default) exposes scenario presets (normal / warning / critical), machine state (idle / operating / heavy load / maintenance), a live-drift toggle and direct sliders for engine temperature, fuel, hydraulic pressure and RPM. It is a demo affordance and never appears in the operator's product surface.

## A note on this folder

Files belonging to an unrelated 3D "digital twin" project (`lib/twin/`, `components/twin/`, `store/twinStore.ts`, `hooks/twin/`, `types/twin.ts`) keep reappearing in `src/` — they are being synced in from outside this build, not created by it. They are not imported anywhere in CAT Visual Assist, and they are excluded in `tsconfig.json` and `eslint.config.mjs` so they cannot break the type check, the lint or the build. Earlier copies were moved to `_legacy/` rather than deleted.
