# Repo analysis: CAT Copilot (Phase 0)

_P2 / Person B ("The Brain"), 2026-09-23. Analysed at `b734951` (= `origin/main`)._

Three analysis passes ran in parallel (simulator + V2V; ML + data + CV; frontend + 3D twin), and each one ran real code: the simulator was run live, the ML tests were run, and data generation and training were run. Every claim below carries a file reference or comes from an observed run.

**Team naming.** The repo uses **Person A–D**. My brief uses P1/P3/P4. The mapping, confirmed from commits and PERSON_C.md, is:

| Brief | Repo | Who (commits) | Owns |
|---|---|---|---|
| P1 | **Person C** | Ekaansh-Jain | `simulator/`, `intelligence/` (ML), `data-gen/`, `data/`, `fixtures/`, `tests/c/`, the director scenarios, and also `web/components/cv/` (webcam CV) |
| P2 (me) | **Person B** | — | backend, agent, RAG, voice, avatar, stream/assistant clients |
| P3 | **Person A** | Mahendra785 | `src/lib/twin`, `src/components/twin`, `src/hooks/twin`, `src/store/twinStore.ts`, `src/types/twin.ts`, `/twin` |
| P4 | **Person D** | Harsh dalmia | `src/app/(product)/*`, `src/components/{cab,command,director,owner,training,ar,alerts,shell,ui}`, `src/lib/api`, `src/lib/hooks` |

**Scope docs.** The tracked `README.md` is P4's old "CAT Visual Assist" readme, which says "no backend". The real scope README (with §10) is the **untracked `README copy.md`**, and `VISION.md` is also untracked. In this doc, "README §N" means `README copy.md`.

---

## 1. Inventory

### 1.1 Person C: simulator, ML, data, CV

| Path | What | State |
|---|---|---|
| `simulator/` (14 files, ~2.3k LOC) | Asyncio site simulator: 9 machines, 6 workers, physics (tip-over moment ratio), safety rules, V2V/V2I, 12 director scenarios, HTTP control API, WS stream | **Working.** Ran live: 15 msgs/s at `--rate 1`. |
| `simulator/schemas.py` | Pydantic models `MachineState`, `WorkerState`, `Event`, `Task`, `Estimate` and the enums. `extra="forbid"`. | Working, but used **only by tests and the fixture export**. The runtime builds hand-written dicts. |
| `intelligence/` | ML + summaries: LightGBM quantile task time + SHAP, rules + IsolationForest anomalies, maintenance extrapolation, headless what-if, working risk, owner/fleet summaries, and thin HTTP wrappers to :8100 | **Partial on this Mac.** LightGBM fails to load (`libomp` missing), so task time uses `planner_fallback` with no SHAP reasons. The anomaly forest trained fine (40 s). |
| `data-gen/generate.py` | Seeded history: 180k telemetry rows, 5,100 tasks, 150 incidents, 4 incident tracks, expert/novice runs | Working (1.7 s). The outputs are gitignored and now exist locally. |
| `fixtures/*.json` (19 files) | One example of every message and output, produced by the live code | Working. `tests/c` enforces them. |
| `tests/c/` | 45 tests | **45 passed** after data-gen and train. Before data-gen: 29 passed, 16 skipped. The task-time tests pass against the fallback. |
| `web/components/cv/` | MediaPipe webcam `PersonDetector` (EfficientDet-Lite0) + `FatigueDetector` (FaceLandmarker blendshapes) | **Working as components, not wired anywhere.** `onEvent` is a callback only: it makes no network call and captures no snapshot. |
| `PERSON_C.md` | C's handoff doc | Mostly accurate. Errata are in §5.3. |

### 1.2 Person A: 3D twin

| Path | What | State |
|---|---|---|
| `src/lib/twin/*`, `src/types/twin.ts` (+ `types/simulation.ts` re-export) | In-browser TS `SimulationEngine` (~60 Hz): 4 machines, 6 workers, own terrain, proximity, 5 s collision look-ahead, own director hooks | **Working standalone.** |
| `src/components/twin/*`, `src/hooks/twin/*`, `src/store/twinStore.ts`, `src/app/twin` | R3F scene, HUD, own DirectorPanel (Ctrl+D), own zustand store | **Working standalone at `/twin`.** No network, not linked from nav, not mounted on `/command`. |

### 1.3 Person D: product frontend

| Route | State | Data |
|---|---|---|
| `/` → `/command` | working | — |
| `/command` | working, **2D SVG plan only** (`hasThreeDimensionalTwin=false`) | FleetSource: mock, or live WS if `NEXT_PUBLIC_API_URL` is set |
| `/cab` (`?machine=`) | working. `AvatarSlot` and `WebcamSlot` are **placeholders** | same |
| `/director` | working | mock mutation, plus `POST {API}/api/director/{id}` in live mode |
| `/owner`, `/training`, `/ar` | working / partial / static | always mock |
| `/dashboard/*`, `/machine/*`, `/simulation` | legacy app (first snapshot) | legacy `useMachineStore` mock |

- `src/lib/api/live-source.ts` is the **only** network client. It is enabled only when `NEXT_PUBLIC_API_URL` is set.
- `src/lib/api/contracts.ts` holds the camelCase domain types the screens consume.

### 1.4 My earlier work (P2)

| Item | State |
|---|---|
| `docs/REPO_ANALYSIS.md`, `docs/P2_SPEC.md`, `HANDOFF.md`, `backend/CLAUDE.md` from session 1 | **Gone from disk.** They were never committed; `*.md` was gitignored at the time. This doc and the Phase 1 spec replace them. |
| `backend/.gitignore` | Present and valid. Kept. |
| Code, tests | **None.** Phase A was interrupted before any file was written. |

There is nothing of mine to re-run. All P2 work starts at Phase A.

---

## 2. Actual stack and versions

| Area | Version / fact |
|---|---|
| Web | Next **16.3.6** (per `AGENTS.md`, a version whose APIs differ from what I know; read `node_modules/next/dist/docs/` before writing Next code), React 19.2.8, TS 5, Tailwind v4, zustand 5.0.15, motion 13, R3F 9.8 / drei 10.7 / three 0.186, rapier3d-compat 0.12, Radix, recharts 3, lucide, sonner. npm with `package-lock.json`. |
| Python | Root `pyproject.toml` (`cat-copilot`, C's): `requires-python >=3.11`, fastapi ≥0.115, uvicorn, websockets 17.1, pydantic 2, numpy, pandas, scikit-learn, lightgbm, shap, httpx. uv lock at root. The venv resolved **Python 3.12.14**. |
| Local toolchain | uv 0.12.18, Node 24, Docker. **No `libomp`** (LightGBM). **No LLM or TTS key in env.** |
| Build health | `tsc`: **6 errors** (all TS2322 icon typing, in P4 and P3 files). `eslint src web`: 41 errors and 12 warnings (P3 twin + C's cv). `web/` type-checks clean. tsconfig/eslint exclude nothing, even though README.md says they do. |
| Imports from `web/` | No alias. `@/*` → `src/*` only. `web/**` is included by tsconfig. From `src/app/dev/stream/page.tsx`: `../../../../web/lib/stream`. |

---

## 3. Existing contracts and where they conflict with README §10

### 3.1 The simulator stream (the de-facto contract)

**Transport.**
- Standalone: `ws://:8100/ws/live` + HTTP on 8100.
- Hub mode: `--mode hub --hub ws://localhost:8000/ws/ingest`.
  - No handshake. One JSON object per text frame. No envelope. No ack.
  - **It never reads its socket.** Anything I send down `/ws/ingest` stalls its keepalive, and the link dies after about 50 s. **`/ws/ingest` must be receive-only for this producer.**
  - Reconnect backoff is 1 → 15 s.
  - The queue holds up to 2,000 messages and **replays a stale burst after downtime**.
  - **One message is lost per disconnect** (it is dequeued before send).

**Rate and order.** Per tick: 9 `machine_state`, then 6 `worker_state`, then events. That is 1 Hz × `--rate`. Director events are pushed out of band, at once.

**`machine_state`.** Every §10 field is present with the §10 name, plus these extras:
- `machine_type`, `status`, `engine_on`
- `boom_angle_deg`, `stick_angle_deg`, `swing_angle_deg`
- `coolant_temp_c`, `nearest_person_m` (capped at 99)
- `fatigue_score`, `fault_codes`, `zone`, `task_eta_min`

Field notes:
- `model` is a bare string: "320", "950", "D6", "745", "140".
- `task_id` is nullable.
- `idle_min`, `fuel_used_l` and `load_cycles` are cumulative since shift start.

**`worker_state`** (not in §10): `{ts, worker_id W01–W06, pos, zone}`.

**`event`.** §10 fields plus **required** `id` (`evt_000001`, which **restarts at 1 when the process restarts**) and `message`. `machine_id` can be null.
- Severities: `info|low|medium|high|critical`.
- Sources: `simulator|scenario|webcam|rules|ml|v2v|v2i`.
- Event kinds (12):

| Kind | Notes |
|---|---|
| seatbelt_unfastened | data: `escalation_level` 1–3 at +0/+5/+10 s |
| seatbelt_fastened | — |
| proximity_alert | critical below 3 m, else high |
| fatigue_alert | — |
| tip_over_warning | critical below 1.2, medium from 1.2 to 1.5 |
| v2v_collision_risk | carries `path_a`/`path_b` (11 points, 0.5 s apart) |
| v2i_suggestion | — |
| anomaly_detected | — |
| maintenance_due | — |
| weather_change | — |
| task_reordered | — |
| working_risk_changed | — |

- `incident_created` is mine to emit.

**Frame and time.**
- Site is 400 × 300 m, origin at the SW corner = (13.0827, 80.2707). x is east, y is north.
- `heading_deg`: 0 = north, clockwise.
- `ts` is wall-clock UTC, second precision, with a `Z` suffix. All messages in one tick share the same `ts`.

**IDs.**
- Machines: EXC001, EXC002 (320), WHL001 (950), DOZ001 (D6), TRK001–004 (745), GRD001 (140). EXC003 exists in the history data only.
- Operators: OP1001–1009 (1:1 with the machines), plus OP1010 spare.
- Workers W01–06. Tasks T-0001…T-0027 (3 per operator, **bound to a machine, type fixed**). Incidents INC-0001…0150. Zones A/B/C/road/yard.

**Control.** HTTP only, and there is **no command channel over WS**:
- `POST :8100/scenario/{name}` with an optional JSON params body.
- `GET /scenarios`, `POST /tasks/{op}/reorder?reason=`.
- `GET /state`, `/machines/{id}`, `/tasks`, `/events`, `/health`, `/site`.

### 3.2 Conflicts

| # | Conflict | Where | Recommended resolution |
|---|---|---|---|
| C1 | §10 is a **subset** of the simulator format: extra fields, `worker_state`, `id`/`message` on events, 5 severities, 7 sources, 12 event kinds | `simulator/schemas.py` vs §10 | **Adopt C's schemas as the canonical wire format.** They are a superset of §10, already live, and test-enforced. My contract package **imports** them rather than duplicating them. Hub-only messages and envelope fields are added on top. |
| C2 | C's hub client never reads, so control can't go over `/ws/ingest` | `simulator/emitter.py:60-111` | Control goes to the simulator via **HTTP proxy** (`/api/director/{s}` → `:8100/scenario/{s}` with body). WS control is only for sources that declare it in an optional `source_hello` (e.g. the twin). |
| C3 | Event `id` restarts on sim restart. Director events arrive twice (in the HTTP response and on the stream). | `safety.py:63` | Keep `id` untouched. The hub adds `rseq` + `epoch` (unique per hub run) and dedupes on `(source, id)` inside one sim session. |
| C4 | Webcam events lack `id` and `ts`, so `Event` validation rejects them | `web/components/cv/*Detector.tsx` | Hub `/api/events` stamps `id` (`cv_…`) and `ts` before validating. No change is needed on C's side. |
| C5 | Director IDs differ: P4 sends `worker_proximity` / `heavy_lift_slope`; the sim has `worker_behind` / `heavy_lift`. P4 lacks `start_shift`, `buckle`, `fatigue`, `loader_queue`. | `src/lib/api/contracts.ts` vs `simulator/scenarios.py` | Hub aliases both names. Snippet for P4 to add the missing buttons. |
| C6 | P4's `live-source` maps only `high/medium/low` severity, so `critical` becomes "warning" | `src/lib/api/live-source.ts:54-58` | Snippet for P4 (`critical` → critical, `info` → info). |
| C7 | Coordinates: the sim is 0..400 × 0..300 with y north. P4's plan is x −110..110 / z −90..110 with SVG y-down (so north renders south). The twin is 260 m centred, −Z north, radians. | `live-source.ts`, `twin-contract.ts:50`, `src/lib/twin/site.ts:8` | Wire stays in sim metres. **I ship `siteToPlan()` and `siteToTwin()` converters** in `web/lib/stream/geo.ts`. P4 and P3 call them (snippet). The transform constants are [TEAM TO CONFIRM]. |
| C8 | The twin uses DZR001 / LDR001 and a different site layout | `src/lib/twin/simulation.ts:64-71` | Canonical = sim IDs. The twin-ts adapter aliases `DZR001→DOZ001` and `LDR001→WHL001`. P3 should consume the live stream rather than run its own world (**team decision**). |
| C9 | P4's `live-source` drops unknown machine IDs and ignores `bubble`, `status`, `worker_state`, and V2V paths. Its V2V line only draws for `kind === "collision"`. | `live-source.ts:132-269`, `site-plan.tsx:31-45` | Snippets for P4. Not mine to edit. |
| C10 | §12 tool signatures differ from C's functions: `reorder_tasks(operator_id, reason)`, `predict_task_time(task: dict)` with no task_id lookup | `intelligence/__init__.py` | My tools keep §12's user-facing names and do the lookup and feature assembly: task → machine model, env weather/visibility/temp, operator skill/years, `estimated_time_min = estimate.p50`. |
| C11 | All ML functions are **sync and slow**: `get_anomalies` 0.4–1.7 s, `owner_summary` 2.2 s, `run_what_if` **37 s**. HTTP wrappers use blocking httpx and swallow errors (a 404 looks like offline). | `intelligence/*` | ML port: `asyncio.to_thread` + per-call timeouts + TTL cache. `run_what_if` runs as a background job, never inline in a chat turn. |
| C12 | Live anomaly flood: with the forest trained, the sim emits about 158 `anomaly_detected` (`unusual_pattern`, `window_min:1`) per 30 sim-minutes | `world.py:219-246` + `anomaly.score_live_window` | The narrator/agent ignores `unusual_pattern` with `window_min==1` (documented, provenance kept). **C should fix at source** (snippet). |
| C13 | History timestamps are "today 08:00–18:00" and some are in the future relative to live `ts` | `data-gen/generate.py:664` | Tools show history as "shift history". No future claims. Reported to C. |
| C14 | README §10 severity example is `"high"`, and severity is the 5-level set | — | Accept all 5. No translation on the wire. |
| C15 | `web/` has no import alias; the CV README's `@/components/cv` doesn't resolve | `tsconfig.json` | Relative imports now. Snippet proposing `"@web/*": ["./web/*"]` to P4 (who owns tsconfig). |

---

## 4. V2V / V2I: what exists (important for §20)

- **V2V** (`v2x.check_v2v`): pairwise straight-line extrapolation (0.5 s steps to 5 s) within 40 m, envelope overlap, closing ≥ 1 m, 10 s debounce. Conflicts near the loader, dump, stockpile or fuel bay are suppressed. **Advisory events only.**
- **V2I**: loader-queue advisory when ≥ 3 trucks are queued (works). The fuel advisory is effectively unreachable. The gate rule is dead code.
- **Shared resources:** only `world.loader_holder`, a mutex with no FIFO. The next holder is chosen by fleet iteration order.
- **There is no reservation, right-of-way, yield, lease or deadlock logic, and nothing acts on V2V/V2I advisories.** "Travel locked" is text only.
- **Tasks don't drive motion.** Behaviour is hard-coded per machine type. There is **no external command hook**: no assign-task, set-route, hold or yield endpoint. Internal primitives exist but are unexposed: `Machine._set_route`, `ov_freeze_motion` (never set), `ov_scripted_motion`, `world.scenario_hooks`.

⇒ Phase E needs (a) a shared deterministic coordination package and (b) a command channel in C's `control_api.py`. **Per the brief, I propose and wait for your decision** (spec §20).

---

## 5. Blockers, missing pieces, errata

### 5.1 Blockers

| # | Blocker | Impact | Fix / owner |
|---|---|---|---|
| B1 | No LLM API key in env | Phase B/D live smoke tests can't run. Fake-LLM tests are unaffected. | You: set `ANTHROPIC_API_KEY` in `backend/.env` |
| B2 | `libomp` missing | No real task-time model or SHAP. The ML port auto-labels `planner_fallback`. | You: `brew install libomp && uv run python -m intelligence.train` |
| B3 | Real README is untracked (`README copy.md`), and `VISION.md` is untracked | Teammates' docs reference a file they don't have | You: commit it as `README.md` (P4's readme can move to `docs/`) |
| B4 | `tsc` red (6 errors, P4/P3 files) | `next build` fails. `next dev` works. | P4 (snippet: type icons as `LucideIcon`) |
| B5 | No sim command channel | Phase E dispatch | C (spec §20) |

### 5.2 Missing (expected soon, or mine)

- **Mine, all of it:** backend hub, REST, agent, RAG, reports, voice, avatar, and the stream/assistant clients.
- **P3:** twin fed from the live stream; the avatar on `/command`.
- **P4:** avatar/webcam wiring in `/cab`; any REST usage beyond director; real `useConnection` status.
- **C:**
  - scenario params from `trigger_scenario`
  - a real `reset` (positions, `idle_min`, `loader_holder` aren't restored)
  - pinning `@mediapipe/tasks-vision` (only a transitive 0.10.17 vs a CDN 0.10.14 WASM)
  - the `useWebcam` ref-count bugs

### 5.3 PERSON_C.md errata (FYI to C)

- 45 tests, not 44.
- Training takes about 40 s with anomalies, not 8 s.
- `unbuckle` does not "clear".
- `start_shift` doesn't reset positions.
- The emitter backlog is replayed, not dropped.
- The rain reorder is a no-op (all 3 tasks share one type).
