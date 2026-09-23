# HANDOFF log: P2 / Person B ("The Brain")

Newest entry at the bottom. The format follows `docs/P2_SPEC.md` §17. Person names match the repo: A = 3D twin (Mahendra), C = simulator/ML/CV (Ekaansh), D = product UI (Harsh).

---

## Phase 0: repo analysis (branch `p2/analysis`)

### → Person C (simulator / ML / CV)

**Ready:** `docs/REPO_ANALYSIS.md`. Your simulator is the canonical wire format, so the backend imports `simulator.schemas` directly and doesn't redefine it.

**What I rely on (please don't change without telling me):**
- Hub mode pushes to `ws://localhost:8000/ws/ingest`. My ingest is **receive-only**, so it will never write to your socket.
- The director goes over HTTP `POST :8100/scenario/{name}` with a JSON body.

**Asks (non-blocking), by hour 12:**
1. **Anomaly flood.** `score_live_window` emits about 158 `unusual_pattern` events per 30 sim-minutes once the forest exists. Please gate forest-only live hits (e.g. require a rule hit, or score ≥ 0.8). Until then I suppress `unusual_pattern` with `window_min == 1` in narration.
2. **`trigger_scenario(name)` can't pass params.** Please add `params: dict | None = None`.
3. **`reset` is partial.** Positions, `idle_min`, `loader_holder` and pinned workers aren't restored, and `World.reset()` is never called.
4. **Pin `@mediapipe/tasks-vision`.** Only 0.10.17 arrives, transitively via drei, while the CDN WASM is 0.10.14.
5. **`useWebcam` ref-count:** it can leak a stream, or go negative on a fast unmount.

**Decision needed from you now:** Phase E (V2V plan execution) needs a command channel into the sim (assign, hold, release) and a shared coordination package. See `docs/P2_SPEC.md` §20. Nothing exists today.

### → Person A (3D twin)

**Ready:** `docs/REPO_ANALYSIS.md` §3.2 C7/C8.

**Decision needed now:**
- Should `/twin` consume the live stream (simulator IDs DOZ001/WHL001, 400×300 m, y north, degrees) instead of its own engine?
- If so, I'll ship `siteToTwin()` and a `TelemetryProvider` adapter in `web/lib/stream`, and your components don't change.

### → Person D (product UI)

**Ready:** `docs/REPO_ANALYSIS.md` §3.2 C5, C6, C7, C9, C15. Snippets follow in the Phase A handoff.

**Heads-up:** `tsc` has 6 errors in your files (TS2322). Typing the icon props as `LucideIcon` fixes all six.

### → Repo owner

`README copy.md` (the real README, with §10) and `VISION.md` are untracked. Please commit them.

---

## Phase 1 — spec (branch `p2/spec`)

### → Person C
Ready: `docs/P2_SPEC.md`. §2 (I import your `simulator.schemas` as canonical), §3.3 (director proxy to :8100 with JSON body), §5.5 (ML port wraps `intelligence` via to_thread). **Decision needed:** §20 — shared `coordination/` package owner + sim command channel (`/machines/{id}/assignment|hold|release`). I won't start Phase E until agreed.

### → Person A
Ready: `docs/P2_SPEC.md` §3.2 (`TwinAdapter`, all mapping in one file), §4 (`LiveTelemetryProvider`, `siteToTwin`). **Confirm:** live stream vs standalone for `/twin`; transform constants.

### → Person D
Ready: `docs/P2_SPEC.md` §4, §13, §15. **Confirm:** I own `src/app/dev/*` (dev-only pages); you add `"@web/*": ["./web/*"]` to tsconfig paths when convenient; avatar mounts in your `AvatarSlot` using your `AvatarState` names.

---

## Phase A — contracts, hub, stream client (branch `p2/hub`)

Gate (all green): `make contracts-check` · `make lint` · `make test` (30 passed; load 10 machines × 20 consumers × 30 s: 0 events lost, p95 fan-out 17–18 ms; slow consumer cut with 4008 then resumed with zero loss) · `make web-check` (tsc + eslint + 12 node tests) · `/dev/stream` live in headless Chrome · **C's real simulator in hub mode verified end-to-end** (9 machines, 0 lenient frames, director proxied, seatbelt escalation 1→2→3 on the stream).

### → Person C (simulator)
**Ready:** hub on `:8000`. Your simulator works **unchanged**:
```bash
cd backend && make dev                                   # hub
uv run python -m simulator --mode hub --hub ws://localhost:8000/ws/ingest   # from repo root, as today
```
**Format you must emit:** exactly `simulator/schemas.py` (you already do: 75/75 frames strict-valid in my run). The hub never writes to your socket. Director: the hub proxies `POST /api/director/{name}` (JSON body = params) to your `POST :8100/scenario/{name}` with a 2 s timeout; D's `worker_proximity`/`heavy_lift_slope` are aliased to your names.
**If you add a field:** fine, the hub accepts it leniently and counts it in `/api/health → sources[].adapter.warnings`; tell me so I regenerate TS types (`make contracts`).
**Fallback source:** `cd backend && make fake-sim` (10 machines incl. your history-only EXC003, badged `provenance: fake`).
**I need (hour 12):** the Phase 0 asks (anomaly flood gate, `trigger_scenario` params, real `reset`), and the §20 decision.
**Limitations:** your queue replays stale bursts after hub downtime — the hub keeps them (states only update "latest" if newer; events older than 30 s are flagged `stale: true`).

### → Person A (3D twin)
**Ready:** `web/lib/stream` — `LiveTelemetryProvider` feeds your existing `TelemetryProvider` seam from the hub; `siteToTwin` converts C's frame (400×300, y north, degrees) to yours (centred, −Z north, radians).
**Snippet (in your engine wiring, e.g. where MockTelemetryProvider is created):**
```ts
import { getStreamStore, LiveTelemetryProvider } from "../../../web/lib/stream"; // or "@web/lib/stream" once D adds the alias
import { terrainHeight } from "@/lib/twin/terrain";
const live = new LiveTelemetryProvider(getStreamStore(), terrainHeight);
live.subscribe((frames) => frames.forEach((t) => engine.applyTelemetry?.(t))); // your call: store.updateTelemetry(t.machineId, t)
live.start();
```
(React components that should connect the socket just call any hook, e.g. `useStreamStatus()`; render loops read `getStreamStore().getState().machines` inside `useFrame` without re-rendering.)
**You must:** add `"live"` to `TelemetrySource` in `src/types/twin.ts`:
```ts
export type TelemetrySource = "keyboard" | "mock_iot" | "live";
```
**Alternatively** (twin as the data source until C's sim is used): `new TwinPublisher(engine).start()` — sends your snapshots to `/ws/ingest`; director commands `worker_behind, dozer_reversing, heavy_lift, hydraulic_spike, rain, reset` call your engine methods.
**Confirm by hour 6:** IDs `DZR001→DOZ001`, `LDR001→WHL001`; transform constants (`TWIN = {offsetX: 200, offsetY: 150, scale: 1}`); my assumption that a positive swingAngle rate = `swing_right`.
**Limitations:** contract has no engine RPM or bucket angle → provider sets `engineRpm: NaN` (render "—") and `bucketAngle: 0`. The stream is 1 Hz: interpolate (e.g. `damp()` toward the latest target) for smooth motion.

### → Person D (product UI)
**Ready:** hub is compatible with your `live-source.ts` today:
```bash
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```
**Snippets for `src/lib/api/live-source.ts` (your file):**
```ts
// 1) C's severities are info|low|medium|high|critical (critical currently becomes "warning")
const SEVERITY: Record<string, SiteAlert["severity"]> = {
  critical: "critical", high: "critical", medium: "warning", low: "info", info: "info",
};
// 2) positions: C's frame is 0..400 x 0..300 m (y north); your plan is centred
import { siteToPlan } from "../../../web/lib/stream/geo";
if (f.pos) patch.position = siteToPlan(f.pos);
// 3) event -> AlertKind (currently "seatbelt_unfastened" etc. leak through as kinds)
const KIND: Record<string, SiteAlert["kind"]> = {
  seatbelt_unfastened: "seatbelt", proximity_alert: "proximity", fatigue_alert: "fatigue",
  tip_over_warning: "tip_over", v2v_collision_risk: "collision", anomaly_detected: "anomaly",
  maintenance_due: "maintenance", weather_change: "weather",
};
kind: KIND[f.event] ?? "anomaly",
```
(also: `machine_id` can be `null` for site-wide events; `data` values can be arrays, e.g. `path_a`.)
**New code can use the hooks directly:** `import { useMachine, useEvents, useActiveAlerts, useStreamStatus } from "../../../web/lib/stream";`
**Webcam CV (`web/components/cv`, mounted by you in `/cab`):** post detector events as-is:
```ts
import { apiBase } from "../../../web/lib/stream";
<PersonDetector machineId="EXC001" onEvent={(e) => fetch(`${apiBase()}/api/events`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(e) })} />
```
Payload = the detector's object (`{type:"event", event, severity, machine_id, source:"webcam", message, data}`); the hub stamps `id`/`ts`. Optional `snapshot: "data:image/jpeg;base64,…"` (≤150 KB, else 413) → stored and returned as `data.snapshot_url`.
**Please:** add to `tsconfig.json` paths `"@web/*": ["./web/*"]`; add director buttons for `start_shift, buckle, fatigue, loader_queue`; confirm I own `src/app/dev/*`; fix the 6 TS2322 icon errors (type as `LucideIcon`).
**Checkpoint (README hour 6):**
1. `cd backend && make dev` 2. `uv run python -m simulator --mode hub --hub ws://localhost:8000/ws/ingest` 3. `NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev` 4. open `/dev/stream` (all 9 machines live), `/cab`, `/command` 5. press a director button → event appears on all three.

**CONTRACT_CHANGES needing sign-off:** 1.0.0 (A, C, D) — `docs/CONTRACT_CHANGES.md`.
