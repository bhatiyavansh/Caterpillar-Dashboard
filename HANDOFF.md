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

---

## Phase B — agent core (branch `p2/agent`)

Gate: `make test` — FakeLLM tests for all 13 tools and every confirm path (confirm, double-confirm idempotent, cancel, supersede, 2-min expiry → 410, unknown → 404, downstream failure → 502 + `action_failed`), first-token/total timeouts, overloaded/rate-limited/refusal/unavailable fallbacks, grounding rejection + one regeneration + deterministic fallback, surface allow-list, parallel tool calls, max 5 rounds. **Live smoke (`make live-smoke`, one question per surface) FAILS: no `ANTHROPIC_API_KEY` on this machine** — it fails loudly by design, never skips.

### → Person D (product UI)
**Ready:** `POST http://localhost:8000/api/assistant` (SSE; `Accept: application/json` for one-shot JSON) and `web/lib/assistant`.
```ts
import { useAssistant } from "../../../web/lib/assistant";   // or "@web/lib/assistant" once the alias lands
const a = useAssistant({ surface: "cab", machineId: "EXC001" });
// a.send("How long will this trench take?")   a.messages   a.status ("thinking"|"calling_tool"|"answering"|"idle"|"error")
// a.pending -> confirm cards: a.confirm(a.pending[0].action_id) / a.cancel(...)  (typing/saying "confirm" also works)
```
Your `AvatarSlot` state maps directly: `a.status === "thinking" | "calling_tool"` → `"thinking"`, streaming → `"talking"` (Phase F adds voice).
**Render `final.text`, not the streamed tokens** — the grounding check can replace an ungrounded draft with a data-only answer. `mode` is `live | fallback` (fallback = answered from live data without the LLM; show a small badge).
Other endpoints: `GET /api/actions?surface=`, `POST /api/actions/{id}/confirm|cancel`, `POST /api/tasks/estimate {task_id}`, `GET /api/anomalies?machine_id=&since_hours=`, `POST /api/whatif {trucks,weather,shift_hours,road_closed,add_spotter}` → `{job_id,status}` then `GET /api/whatif/{job_id}` (~40 s first time, cached after).
**Stream events you may want:** `action_pending / action_confirmed / action_cancelled / action_failed`, `incident_created`, `work_order_created`, `training_booked` (contract 1.1.0).
**I need (hour 14):** confirm the cab mount point for the assistant (your `AvatarSlot` `onPushToTalk` → `a.send` via voice in Phase F).

### → Person C (ML / simulator)
**Ready:** `docs/ML_INTERFACE.md` — exactly how I call `intelligence` (to_thread + timeouts + TTL cache + auto real⇄stub switch every 60 s) and the features I assemble for `predict_task_time`. Reorder confirmations call your `POST /tasks/{op}/reorder`; tasks come from `GET /tasks/{op}` (fixture fallback labelled).
**Asks (hour 12):** see ML_INTERFACE §"What would make it better" — especially `models_available()` returning False when LightGBM can't import, and the live anomaly flood.
**Known limitation on this Mac:** task time is `planner_fallback` (no libomp → no LightGBM/SHAP); the agent says so via provenance.

### → Person A (3D twin)
Nothing required. `run_what_if` results (`current/scenario/delta`) are available via REST for a before/after overlay if you want it.

**CONTRACT_CHANGES needing sign-off:** 1.1.0 (D, C).

---

## Phase C — knowledge, reports, CV (branch `p2/knowledge`)

Gate: `make test` 79 passed · `make index` (81 chunks, local `BAAI/bge-small-en-v1.5`; runtime never downloads) · `make rag-eval` **hit@5 = 18/18** · every safety event maps to exactly one protocol; steps byte-identical to the files; OSHA quotes verified verbatim against the eCFR text at load time (hub refuses to start otherwise) · verified live: C's `seatbelt_unfastened` and hydraulic `maintenance_due` events arrive with `protocol` attached.

**Corpus (what the assistant can cite):** 29 CFR 1926.21, .600–.602, .650–.652 (eCFR, public domain, cited by section — no pages) + `Demo site manual` (team-authored from the simulator's actual thresholds, cited by page; HYD-118, seatbelt escalation, tip-over gauge, bubble, V2V, fatigue). osha.gov PDFs were not retrievable (403), so no OSHA booklets.
**Protocols:** `backend/data/protocols/*.md` — seatbelt, proximity, fatigue, tip-over, V2V, hydraulic overheat (`maintenance_due` + `component: hydraulic_pump`), incident reporting. Steps are "Demo site SOP"; regulation quotes are verbatim 29 CFR text.

### → Person D (product UI)
- **Every safety event now carries `protocol`** (contract 1.2.0): `{id, title, severity, steps[], escalation[], source, regulation?{citation, quote}}`. Render the steps **exactly as sent** under the alert:
```tsx
{alert.protocol && (<ol>{alert.protocol.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>)}
{alert.protocol?.regulation && <small>{alert.protocol.regulation.citation}</small>}
```
- Assistant answers now include `final.citations[]` (`kind: "manual" | "protocol"`, `citation`, `page?`, `section?`, `quote`) — show them as footnotes; never speak them.
- REST: `GET /api/protocols`, `/api/protocols/{id}`, `GET /api/rag/search?q=`, `GET/POST /api/incidents` (POST files immediately — it *is* the explicit human action), `GET /api/incidents/{id}` (includes `draft`, `draft_source`, `facts`, `protocol`, `snapshot_url`), `GET/POST /api/work-orders`, `GET /api/reports/weekly` (owner portal: `prose`, `prose_source`, `data`, `kpis`, cached 24 h), `GET /api/anomalies?explain=true` (each anomaly gets a cached `explanation`).
- **Webcam snapshot:** when a detector fires, send a JPEG frame ≤150 KB with the event:
```ts
const snapshot = canvas.toDataURL("image/jpeg", 0.6);   // keep it small
fetch(`${apiBase()}/api/events`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...e, snapshot }) });
```
  Incidents filed from that event carry the snapshot and the matched protocol.

### → Person C
- Your events are enriched in the hub only (added `protocol` key); your payload fields are untouched.
- Protocol thresholds quoted in the demo manual come from your code (`HYDRAULIC_ALERT_C` 95/90 °C, escalation +0/+5/+10 s, tip-over 1.5/1.2, bubble radii, fatigue 0.75) — if you change them, tell me so the manual stays true.
- `owner_summary(7)` powers the weekly report (5 s timeout, cached 10 min).

### → Person A
- Events carry `protocol` too; if the twin shows alert cards, the same snippet as D applies.

**CONTRACT_CHANGES needing sign-off:** 1.2.0 (D, A).
**Limitations:** describe_scene (vision, advisory) is behind `CV_DESCRIBE=1` and untested against the real model (no API key). Report drafts use the fast model; without a key every draft is the labelled template (`draft_source: "template (llm unavailable)"`).
