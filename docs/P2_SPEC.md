# P2 spec: The Brain (Person B)

_Rewritten 2026-09-23 from `docs/REPO_ANALYSIS.md`._

- Scope comes from README (the untracked `README copy.md`). VISION.md is used only where pulled in (§5c, §20).
- Tags: **[DECIDED]** = mine, settled unless someone objects. **[TEAM TO CONFIRM]** = needs a named teammate's yes.
- Person names follow the repo: **A** = 3D twin, **C** = simulator/ML/CV, **D** = product UI.

---

## §0 Ownership [DECIDED]

### I write only in

| Path | Contents |
|---|---|
| `backend/**` | Hub, adapters, agent, tools, RAG, protocols, reports, CV ingest, plans, voice, narrator, cache, eval, ops, contracts, `backend/scripts/*` |
| `web/lib/stream/**` | Generated contracts, stream client, zustand store, hooks, geo converters, twin provider |
| `web/lib/assistant/**` | SSE assistant client + hooks |
| `web/components/avatar/**` | Avatar |
| `src/app/dev/**` | Dev-only pages (`/dev/stream`, `/dev/avatar`). Not linked from the product. **[TEAM TO CONFIRM: D]** |
| Docs | `docs/P2_*.md`, `docs/REPO_ANALYSIS.md`, `docs/ML_INTERFACE.md`, `docs/CONTRACT_CHANGES.md`, `HANDOFF.md` |

### I never edit

`simulator/`, `intelligence/`, `data-gen/`, `data/`, `fixtures/`, `tests/c/`, `web/components/cv/`, `src/**` (except `src/app/dev`), the root `pyproject.toml`, `package.json`, `tsconfig.json`, `eslint.config.mjs`, or `README*`.

When one of those needs a change, the owner gets a snippet (§17).

### Path translation of the brief

- `scripts/fake_sim.py` becomes **`backend/scripts/fake_sim.py`**.
- `data/protocols` becomes **`backend/data/protocols`**, because root `data/` is C's generated data.

### Python project

`backend/pyproject.toml` is a **separate uv project**. It takes a path dependency on the root `cat-copilot` package, so it imports `simulator.schemas` and `intelligence` without editing C's `pyproject.toml`. It has its own lockfile and `backend/.venv`.

---

## §1 Quality bar [DECIDED]

1. **Async only.**
   - Sync libraries (C's `intelligence`, SQLite writes, BM25, fastembed) run through `asyncio.to_thread` or an async driver.
   - Network I/O uses `httpx.AsyncClient`.
2. **Every network, LLM or TTS call has a timeout and a fallback.** Timeouts:

| Call | Timeout |
|---|---|
| LLM first token | 5 s |
| LLM total | 20 s |
| Router LLM | 1.5 s |
| Tool | 3 s |
| Sim HTTP | 2 s |
| ML (fast calls) | 2 s |
| ML what-if | background job |
| TTS | 4 s |
| RAG | 1.5 s |

   The fallback for each is listed in §15.
3. **Contracts change additively only.**
   - Every addition is logged in `docs/CONTRACT_CHANGES.md`.
   - `make contracts-check` fails on a removed or retyped field, or on a manifest change without a new changelog version.
4. **Safety alerts and safety responses are deterministic and never LLM-generated.**
   - Safety events and their protocol steps come from rules, CV or documents.
   - The safety specialist quotes protocol steps verbatim.
   - A test asserts the LLM is not called on the safety path.
5. **Facts, numbers, IDs and protocol steps come from data or documents.**
   - A grounding check (§5.6) rejects ungrounded numbers and IDs.
   - Protocol steps are copied verbatim, never paraphrased.
6. **Tests never hit the network.**
   - `pytest-socket` allows only `127.0.0.1` / `::1` / unix sockets.
   - The LLM, TTS and embedder are faked.
   - Live tests are marked `@pytest.mark.live` and deselected by default.
7. **No silent stubs.** Anything stubbed, faked, cached or replayed carries `provenance`. `/api/health` lists every stub. Every stub endpoint returns header `X-Stub: 1`.
8. **Tests are never skipped or weakened to pass.** A test that can't pass is reported plainly.
9. **Done = the phase gate in §18 passes, a commit lands on `p2/<phase>`, and HANDOFF is appended.**

---

## §2 Contracts

### 2.1 Package [DECIDED]

- `backend/copilot/contracts/` holds everything.
- **C's `simulator.schemas` is imported, not copied:** `MachineState`, `WorkerState`, `Event` and their enums are the canonical stream payloads (REPO_ANALYSIS C1).
- My package adds:
  - envelope fields
  - hub-only messages (`hello`, `snapshot`, `heartbeat`, `control`, `control_ack`, `utterance`, `source_hello`)
  - assistant SSE events
  - the protocol attachment on events
- Phase E adds the plan messages.

### 2.2 Codegen [DECIDED]

`make contracts` does all of the following:
- **Pydantic → JSON Schema:** writes `backend/copilot/contracts/schema.json`.
- **In-repo generator → TypeScript:** writes `web/lib/stream/contracts.gen.ts`. There is no npm or network dependency.
- **Manifest:** writes `manifest.json`, the flat list of `Model.field: type` plus the version.

`make contracts-check` regenerates to a temp dir and **fails** if any of the following is true:
- The generated files differ from the committed ones (stale).
- A manifest field was removed or retyped (non-additive change).
- The manifest changed but `CONTRACT_VERSION` didn't bump, or the new version has no `## <version>` entry in `docs/CONTRACT_CHANGES.md`.

### 2.3 Envelope [DECIDED]

Every message the hub sends on `/ws/live` carries these fields:

| Field | Meaning |
|---|---|
| `seq` | Hub-global counter, **strictly increasing per connection**. It may skip values: coalescing drops superseded states, and snapshots are per-connection. |
| `epoch` | Hub-run id. When it changes, the client resets. |
| `hub_ts` | ISO time, ms precision |
| `rseq` | Only on **reliable** messages (`event`, `utterance`, and the plan/coordination messages later). **Contiguous** per epoch, so a gap means loss. |

Ingest payloads never carry envelope fields. The hub strips any it receives.

### 2.4 Server → client messages [DECIDED]

| type | When | Payload |
|---|---|---|
| `hello` | First frame | `server`, `contract_version`, `epoch`, `resumed: bool`, `sources[]`, `features {llm, tts, rag, ml}` with provenance |
| `snapshot` | After `hello`. On a resync, it comes after the replayed events. | `ts`, `rseq_at` (the rseq the snapshot is consistent with), `machines[]`, `workers[]`, `active_alerts[]`, `environment{}`, `sources[]`, `events_truncated: bool` |
| `machine_state`, `worker_state`, `event` | Live | C's schema plus the envelope. Events also get `protocol?` (§5b) and `snapshot_url?` (§5d). |
| `utterance` | Narrator (Phase G) | `utterance_id`, `text`, `priority` (`safety\|normal\|chatter`), `surfaces[]`, `machine_id?`, `reason`, `deterministic`, `audio_url?` |
| `heartbeat` | Every 5 s | `last_seq`, `last_rseq`, `sources[]`, `clients` |

### 2.5 Client / producer → hub messages [DECIDED]

- **Resync = reconnect** with `/ws/live?since_rseq=N&epoch=E`.
  - If the epoch matches and N is still in the ring (10,000 reliable messages), the hub replays every reliable message with `rseq > N` (re-stamped `seq`, original `rseq`), then sends a fresh `snapshot`. The replay gets extra outbox headroom, so it can never trip the slow-consumer limit.
  - Otherwise it sends a `snapshot` with `events_truncated=true`, and the client fetches the gap from `GET /api/events?since=`.
- **`/ws/ingest` sources:**
  - C's sim sends **no handshake**. A first frame of `machine_state`/`worker_state`/`event` identifies it as `kind:"sim"`. The hub never writes to it.
  - Other sources may send `source_hello {source_id, kind: "sim"|"twin"|"webcam"|"replay"|"fake", format: "contract"|"twin_snapshot", accepts_control: bool}`.
  - Sources with `accepts_control` receive `control {command_id, command, args}` and must reply `control_ack {command_id, ok, error?}`.

### 2.6 Assistant SSE events [DECIDED]

`POST /api/assistant` returns `text/event-stream`. With `Accept: application/json` it returns the `final` payload as JSON instead.

| event | data |
|---|---|
| `meta` | `turn_id`, `surface`, `mode: live\|cache\|fallback`, `model` |
| `specialist` | `id`, `label`, `routed_by: rules\|llm\|fallback`, `confidence` |
| `status` | `thinking\|calling_tool\|answering` |
| `tool_call` / `tool_result` | `call_id`, `name`, `args` / `ok`, `summary`, `provenance`, `latency_ms` |
| `token` | `delta` |
| `citation` | `kind: manual\|protocol`, `doc_id`, `title`, `page\|step`, `quote` |
| `confirm_required` | `action_id`, `tool`, `args`, `summary`, `expires_at` |
| `final` | `text`, `speak_text`, `citations[]`, `actions[]`, `grounded` |
| `error` | `code`, `message`, `fallback_used` |
| `done` | — |

---

## §3 Hub + SourceAdapter

### 3.1 Shape [DECIDED]

- **Process:** FastAPI + uvicorn on **:8000**, one process.
- **`World`:** holds the latest state per machine and worker, active alerts, environment, the reliable ring (10,000 messages), and a per-source dedupe of `(source_id, event.id)`.
- **`Broadcaster`:** each client has an outbox made of:
  1. a **reliable deque**. It is never dropped. If it passes `MAX_PENDING_RELIABLE` (default 5,000), or a send blocks longer than `SLOW_SEND_TIMEOUT_S` (default 5), the client is disconnected with close code **4008**. It then reconnects with `since_rseq` and loses nothing.
  2. **coalescing maps** keyed by `machine_id` / `worker_id`. A newer state replaces the older one.

  The sender merges both in `seq` order. Publishing is synchronous: serialise once, then fan out with no awaits, so one slow client can't stall the others.
- **Persistence:** batched SQLite through aiosqlite. It flushes every 0.5 s or every 500 rows. States are kept at most once per entity per second; every event is kept. Tables: `states`, `workers`, `events`. A DB failure makes health `degraded` and does not crash the hub.
- **Staleness:** C's queue replays stale bursts after downtime. States with `ts` older than the latest for that machine are ignored for "latest" but still persisted. Events are kept and flagged `stale:true` if older than 30 s.

### 3.2 SourceAdapters [DECIDED]

| Adapter | Input | Mapping |
|---|---|---|
| `SimAdapter` (default) | C's frames (no handshake) | Validate with C's models. If that fails, validate leniently (extras allowed) and increment `contract_warnings` (surfaced in health). Only `machine_id`/`worker_id`/`event` are hard-required. |
| `TwinAdapter` | A's `UiSnapshot` via an optional `TwinPublisher` | **All mapping is in `backend/copilot/adapters/twin_mapping.py`:** IDs `DZR001→DOZ001`, `LDR001→WHL001`, `WRK00n→W0n`; radians→degrees; `(x, z)` → site metres via a configurable offset/scale; `Infinity→null`; `activity→intent`; alert kinds → C's event names; alert appear/clear diffing. Missing fields such as `seatbelt` are left absent, never invented. |
| `WebcamAdapter` | `POST /api/events` or ingest with `source:"webcam"` | Stamps `id` (`cv_<n>`) and `ts`. Accepts a ≤150 KB snapshot (§5d). |
| `FakeAdapter` | `backend/scripts/fake_sim.py` (it speaks C's format with `source_hello kind:"fake"`) | Identity. Badged `provenance:"fake"`. |

- **Source policy [TEAM TO CONFIRM: C, A]:** priority `sim > twin > fake`. One authoritative world source at a time; webcam is always merged on top.
- When the active source is silent for 3 s: it is marked disconnected and an `event source_changed` fires. The next source by priority becomes active, and the world is cleared and re-snapshotted.

### 3.3 Director [DECIDED]

`POST /api/director/{scenario}` takes an optional JSON body of params.

- **Aliases:** `worker_proximity→worker_behind`, `heavy_lift_slope→heavy_lift`.
- **Routing by active source:**
  - **sim:** HTTP proxy to `:8100/scenario/{name}` (2 s timeout). The response is returned as-is plus `routed_to`.
  - **twin:** `control` over WS, waiting 2 s for `control_ack`.
  - **fake:** `control`.
- **Failure codes:** 404 unknown scenario, 503 no source, 504 timeout, 502 sim error. **Never a silent success.**
- `GET /api/director` lists the scenarios, fetched from sim `/scenarios` with the fake list as fallback.

---

## §4 Stream client: `web/lib/stream` [DECIDED]

- **`StreamClient`**
  - Framework-free; the WebSocket constructor is injectable (for tests).
  - Backoff 0.5 → 8 s with jitter.
  - Status: `connecting|live|stale|offline`. It turns stale after 12 s with no frames.
  - Keeps `epoch` and `last_rseq` across reconnects and reconnects with `since_rseq`.
  - An `rseq` gap closes the socket and resyncs.
  - URL is `NEXT_PUBLIC_COPILOT_WS` or `ws://localhost:8000/ws/live`.
- **Store:** a **rendering-free zustand vanilla store**, `createStreamStore()`.
  - Machine updates replace only that machine's object.
  - Consumers read `getState()` inside `useFrame`/rAF without subscribing.
  - Events are a bounded log (500) plus `activeAlerts`.
- **Hooks:** `useStreamStatus`, `useMachine(id)`, `useMachineIds()`, `useMachines()`, `useWorkers()`, `useEvents(filter)`, `useActiveAlerts()`, `useStreamStore(selector)`. All use `useStore(store, selector)`, with shallow equality for lists.
- **`geo.ts`:** `siteToPlan(pos)` for D's SVG plan and `siteToTwin(pos)` for A's twin. The constants are exported. **[TEAM TO CONFIRM: A, D]**
- **`twin.ts`:** `LiveTelemetryProvider` implements A's `TelemetryProvider` (contract → `MachineTelemetry`).
- **`/dev/stream`:** status, epoch/seq/rseq, source badges, machine table, event log, director buttons, fan-out latency.

---

## §5 Agent + tools + ML port + confirm

### 5.1 LLM [DECIDED; key TEAM TO CONFIRM]

- Anthropic Messages API through the async SDK, via `client.beta.messages.stream`. The beta surface is needed for server-side refusal `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). All of this sits behind `LLMPort`; tests use `FakeLLM`.
- **Models:**
  - `LLM_MODEL` defaults to **`claude-opus-5`**, with adaptive thinking (the default) and `effort` per surface: `low` for cab, training and AR; `medium` for command and owner.
  - `LLM_FAST_MODEL` (router, report drafts) defaults to `claude-haiku-4-5`. It gets no `effort` and no fallbacks, since Haiku doesn't take them.
  - Changing either needs only an env var.
- **Content handling:** the model's full content blocks (including thinking) are appended to the history verbatim. Tools use `eager_input_streaming`, and every input is validated by Pydantic before it runs.
- **Retries and timeouts:** SDK retries are off (`max_retries=0`). Timeouts: first token 5 s (first content block of any kind), total 20 s shared by all rounds.
- **Errors:** overloaded (529), rate-limited, refusal and unavailable all map to the fallback. The fallback is a deterministic answer built from tool results, or from read-only tools picked by keyword rules; the demo cache joins in Phase G.
- **Credentials:** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` or an `ant auth login` profile. With none of them, health reports `llm: down` and every answer is data-only (`mode: "fallback"`).

### 5.2 Registry [DECIDED]

`Tool{name, description, input_model: BaseModel, requires_confirmation, surfaces: set, specialists: set, timeout_s, handler}`.

- The JSON schema comes from the Pydantic model.
- The model's arguments are validated before the handler runs.
- Surface allow-list (`cab`, `command`, `owner`, `training`, `ar`) is enforced both when tools are offered and when a call is executed.

### 5.3 Loop [DECIDED]

- At most **5 rounds**. Tool calls within a round run in parallel (`asyncio.gather`).
- Per-surface system prompt plus a compact live context from `World`.
- SSE per §2.6.
- JSONL turn log at `backend/logs/turns.jsonl`: turn_id, surface, specialist, messages, tool calls/results, latency, mode, grounded.

### 5.4 Tools [DECIDED]

| Tool | Backed by | Confirm |
|---|---|---|
| get_machine_status(machine_id) | hub `World` (live), plus active alerts | – |
| get_fleet_overview() | `World` + `intelligence.fleet_kpis` (to_thread, 30 s TTL) | – |
| get_shift_tasks(operator_id \| machine_id) | sim `GET /tasks/{op}` (async httpx); machine→operator taken from `World` | – |
| reorder_tasks(operator_id, reason) | sim `POST /tasks/{op}/reorder` | **yes** |
| predict_task_time(task_id) | looks up the task, assembles C's 13 features (machine model, env, operator skill/years, `estimated_time_min = estimate.p50`), then `intelligence.predict_task_time` | – |
| get_anomalies(machine_id?, since_hours) | `intelligence.get_anomalies` (to_thread, 60 s TTL) | – |
| get_maintenance_forecast(machine_id?) | `intelligence.get_maintenance_forecast` | – |
| get_recent_events(machine_id?, types?, minutes) | hub SQLite | – |
| search_manual(query) | §6 | – |
| get_protocol(event \| protocol_id) | §5b | – |
| create_incident(machine_id, event_id?, summary?) | §7 | **yes** |
| create_work_order(machine_id, issue) | §7 | **yes** |
| book_training(operator_id, module) | `intelligence.training_profiles` + `backend/data/training_slots.json` | **yes** |
| run_what_if(params) | ML port what-if job: disk cache keyed by params; waits ≤3 s, else returns `{status:"running", job_id}` | – |

### 5.5 ML port [DECIDED; interface TEAM TO CONFIRM: C]

- `MLPort` Protocol: `estimate_task`, `anomalies`, `maintenance`, `what_if`, `working_risk`, `fleet_kpis`.
- **`RealML`** wraps `intelligence` with to_thread and timeouts. Provenance per call: `lightgbm_quantile` or `planner_fallback` (read from C's `model` field), `rules+iforest` or `rules`.
- **`StubML`** is deterministic: formulas seeded from the brief's 4 rows. Provenance `stub`.
- **Auto-switch:** `ML_MODE=auto` probes `intelligence` import plus `data/telemetry.csv` every 60 s and switches live. Health shows the current mode.
- The interface is documented for C in `docs/ML_INTERFACE.md`.

### 5.6 Grounding [DECIDED]

- Extract numbers (with units), IDs (`[A-Z]{3}\d{3}`, `OP\d{4}`, `T-\d{4}`, `INC-\d{4}`, `W0\d`, fault codes) and percentages from the answer.
- Each must match, after normalisation, a value in that turn's tool results, citations or live context. Numbers get a ±0.5 %-rounding tolerance.
- **On failure:** regenerate once with a correction. If it still fails, use a deterministic template answer built from the tool results, with `grounded:false` logged.

### 5.7 Confirm flow [DECIDED]

1. A confirm tool never executes directly. It creates a `PendingAction{action_id, tool, args, summary, surface, expires_at: now+120 s}` and emits `confirm_required`.
2. `POST /api/actions/{id}/confirm` and `/cancel` are idempotent. An expired action returns 410. A newer pending action on the same surface supersedes the older one.
3. On confirm, the tool runs and the hub emits reliable `event`s: `action_confirmed` plus the domain event (`incident_created`, `work_order_created`, `training_booked`, `task_reordered` comes from the sim).
4. Voice "confirm" / "cancel" is matched client-side by regex (Phase F), never by the LLM.

---

## §5b Protocol RAG [DECIDED; content TEAM TO CONFIRM: all]

- **Location:** `backend/data/protocols/*.md`.
- **Frontmatter:** `id`, `title`, `applies_to_events[]`, `match` (optional data conditions, e.g. `component: hydraulic`), `severity`, `roles[]`, `steps[]`, `escalation[]`, `source`.
- **Content** comes only from public OSHA text quoted verbatim with the CFR citation, or from our own SOPs labelled `source: "Demo site SOP"`.
- **Protocols:** one per safety event:
  - `seatbelt_unfastened`
  - `proximity_alert`
  - `fatigue_alert`
  - `tip_over_warning`
  - `v2v_collision_risk`
  - plus `incident_reporting` and `hydraulic_overheat` (`maintenance_due` with component hydraulic, or `HYD-118`)
- **Attachment:** deterministic, on the hub, at publish time. The event gets `protocol{id, title, severity, steps[], escalation[], source}` with steps **verbatim**.
- **Load-time validation:** every safety event matches exactly one protocol, or the hub refuses to start.
- **Tool:** `get_protocol`.
- Tests assert steps are byte-identical to the file.

## §5c Specialist routing (VISION §11, scoped) [DECIDED]

- **Specialists:** `safety`, `planner`, `maintenance`, `training`, `reporting`, `coordination`, plus a `general` fallback. Each has its own prompt and tool subset. All run on the single loop, with no agent-to-agent calls.
- **Router:**
  1. Keyword/regex rules with weights.
  2. If the top two scores are within the margin, or nothing matched, one fast-LLM classification call with a 1.5 s timeout.
  3. On timeout or error: `general`, with all the surface's tools.
- Emits SSE `specialist`.
- **Safety specialist:** answers "what do I do" questions with `get_protocol` steps verbatim. The LLM may only frame the answer around the verbatim block, and the block is inserted by code.

## §5d CV integration [DECIDED]

- `POST /api/events` accepts C's webcam events as-is (`id`/`ts` stamped) plus an optional `snapshot: "data:image/jpeg;base64,…"`.
- The snapshot is limited to **≤150 KB decoded** (413 otherwise). It is stored at `backend/data/cv_snapshots/<id>.jpg` and served at `/api/cv/snapshots/<id>.jpg`. The event gets `snapshot_url`.
- Incidents created from a CV event attach the snapshot and the matched protocol.
- **`describe_scene(event_id)`:** behind `CV_DESCRIBE=1`, uses the vision LLM, is advisory only (labelled), is never used for safety decisions, and falls back to "unavailable".

## §6 Manual RAG [DECIDED; corpus TEAM TO CONFIRM]

- **Corpus:** `backend/data/manuals/` holds public OSHA publications (if fetched) plus our fault-code table (`fault_codes.md`, labelled demo, covering `HYD-118`).
- **`make index`:** page-aware chunks (~350 words, 60 overlap), BM25 (`rank-bm25`), and **fastembed** `BAAI/bge-small-en-v1.5` run locally. Stored in `backend/data/index/`.
- **Query:**
  1. Fault-code regex exact hit.
  2. BM25 ∪ cosine, fused with RRF (k=60), top 5 with page citations.
  3. Below threshold: "not in the manuals", with no LLM call.
- **`make rag-eval`:** demo questions must reach **hit@5 = 100%**.
- Tests use BM25 plus a fake embedder.

## §7 Reports [DECIDED]

- **Incidents:**
  1. DB snapshot: states ±60 s, events and the protocol from SQLite/ring.
  2. The fast LLM drafts a **structured** draft (JSON schema).
  3. Validation: schema plus grounding (every fact must be in the snapshot).
  4. One retry, then a template fallback.
  5. Stored as a `draft` until confirmed. Confirming emits `incident_created`.
- **Work orders:** same pattern, using maintenance forecast plus fault codes.
- **Weekly owner report:** pre-generated from `owner_summary` + `fleet_kpis` (+ LLM prose with template fallback), cached on disk. `GET /api/reports/weekly` serves the cache.
- **Anomaly explanations:** cached by a stable key (`machine_id|type|window.start`), because C's `anomaly_id` isn't stable.

## §8–§10 Voice, voice hook, avatar (Phase F; summary) [DECIDED]

- **TTS proxy:** `POST /api/tts` (4 s timeout; speakable-text normalisation; sha256 disk cache). On failure it returns 204 with `X-TTS-Fallback: browser`.
- **Voice hook:** `useVoiceAssistant` (Web Speech en-IN, push-to-talk, sentence-streamed TTS, barge-in, local confirm/cancel regex, `speechSynthesis` fallback).
- **Avatar:** `<Avatar/>`, `<AvatarRig/>` and `Avatar2D` share D's `AvatarState` (`idle|listening|thinking|talking|alert`). The avatar is mounted in D's `AvatarSlot`.

## §11 Narrator (Phase G) [DECIDED]

- Safety lines come from templates with pre-rendered audio, plus the protocol steps.
- Cooldowns; seatbelt escalation follows C's `escalation_level`.
- Plan milestones are non-safety lines.
- `unusual_pattern` live anomalies are ignored (REPO_ANALYSIS C12).

## §12 Demo cache + eval (Phase G) [DECIDED]

- `backend/demo/demo_cache.yaml` covers README §19 plus the plan demo.
- rapidfuzz matching; forced and fallback modes.
- `make record-cache` shows the answers before saving.
- `make eval-demo` runs in both modes.

## §13 Embed pack [DECIDED]

| Package | Exports |
|---|---|
| `web/lib/stream` | hooks, `geo`, `LiveTelemetryProvider` |
| `web/lib/assistant` | `useAssistant`, `streamAssistant`, `confirmAction`, `cancelAction` |
| `web/components/avatar` | Phase F |
| Phase G | `AssistantDock`, `usePlan` |

Imports from `src/` are relative until D adds `"@web/*": ["./web/*"]` to tsconfig (snippet).

## §14 Ops [DECIDED]

- `GET /health` is liveness.
- `GET /api/health` reports: sources, clients, seq/rseq, epoch, db, persistence lag, ml mode, llm, rag, protocols, the **stub list**, contract warnings and dropped-producer messages.
- Phase H adds `make preflight`, `scripts/chaos.py` and `docs/DEMO_RUNBOOK_P2.md`.

## §15 Endpoint table

| Method | Path | Phase | Timeout → fallback |
|---|---|---|---|
| WS | `/ws/live` | A | — |
| WS | `/ws/ingest` | A | active source silent 3 s → next source |
| GET | `/health`, `/api/health` | A | — |
| GET | `/api/fleet` | A | — |
| GET | `/api/snapshot` | A | — |
| GET | `/api/machines/{id}/history?from&to&limit` | A | — |
| GET | `/api/events?since_rseq\|from&to&types&machine_id&limit` | A | — |
| POST | `/api/events` | A (+snapshot C) | — |
| GET | `/api/replay?from&to&machine_ids&include=states,workers,events` | A | — |
| GET | `/api/director` | A | sim 2 s → built-in list |
| POST | `/api/director/{scenario}` | A | sim 2 s → 504 |
| GET | `/api/contract` | A | — |
| POST | `/api/assistant` (SSE/JSON) | B | LLM 5 s/20 s → cache → deterministic |
| POST | `/api/actions/{id}/confirm`, `/cancel` | B | — |
| GET | `/api/actions?surface` | B | — |
| POST | `/api/tasks/estimate` | B | ML 2 s → stub |
| GET | `/api/anomalies` | B | ML 3 s → stub |
| POST | `/api/whatif`, GET `/api/whatif/{job}` | B | background job |
| GET | `/api/protocols`, `/api/protocols/{id}` | C | — |
| GET | `/api/rag/search?q` | C | 1.5 s → BM25-only |
| POST/GET | `/api/incidents`, `/api/incidents/{id}` | C | LLM → template |
| POST/GET | `/api/work-orders` | C | LLM → template |
| GET | `/api/reports/weekly` | C | cache |
| GET | `/api/cv/snapshots/{name}` | C | — |
| POST | `/api/tts` | F (stub until then) | 4 s → 204 browser |
| * | `/api/plans/*` | E (stub until then) | — |

Until its phase lands, every endpoint returns **501 with `X-Stub: 1`**.

## §16 Integration map

| Teammate | Gives me | Gets from me |
|---|---|---|
| **C** | sim hub mode → `/ws/ingest`; director scenarios on :8100; the `intelligence` API; (Phase E) a command channel | contracts reuse; director proxy; ML port; `ML_INTERFACE.md`; protocols; fake_sim |
| **A** | twin consumes the stream, or publishes via `TwinPublisher` | `LiveTelemetryProvider`, `siteToTwin`, (later) `v2v_message` lines, avatar |
| **D** | sets `NEXT_PUBLIC_API_URL=http://localhost:8000`; applies the live-source severity/scenario/geo snippets; mounts the avatar and assistant; wires CV `onEvent` → `postEvent` | `web/lib/stream`, `web/lib/assistant`, avatar, REST |

## §17 Handoff protocol [DECIDED]

Every phase ends with a "SEND TO TEAMMATES" section (also appended to `HANDOFF.md`) containing one message per affected teammate. Each message has:
1. **Ready:** what shipped.
2. **Use it:** exact URLs, endpoints, imports and props.
3. **Snippet:** minimal working code for their file.
4. **You must:** what they need to implement or change.
5. **I need, by hour:** asks with deadlines.
6. **Known limitations.**
7. **Sign-off:** CONTRACT_CHANGES entries that need their approval.

## §18 Acceptance gates (exact commands; run from `backend/`)

| Phase | Gate |
|---|---|
| A | `make contracts-check` · `uv run ruff check .` · `uv run pytest -q` (includes coalescing, slow consumer, resync, load 10 machines × 20 consumers × 30 s with 0 event loss and p95 fan-out < 50 ms) · `make web-check` (tsc + eslint on my files + node tests of `web/lib/stream`) · `/dev/stream` shows live fake_sim data (headless Chrome DOM check) |
| B | `uv run pytest -q` (fake-LLM tests for every tool and every confirm path) · `uv run pytest -m live -q` (one question per surface; **needs `ANTHROPIC_API_KEY`**) |
| C | `uv run pytest -q` · `make index` · `make rag-eval` (hit@5 = 100%) · protocol test: every safety event → exactly 1 protocol, steps verbatim |
| D | `uv run pytest -q` · `make router-eval` (25 labelled questions, confusion table printed, p95 overhead < 300 ms) · timeout fallback test |
| E–H | per the brief; to be detailed when started |

## §19 Open questions

1. Is C's `simulator.schemas` the canonical wire format, with §10 as a subset? *(all; recommended yes)*
2. Does `/twin` consume the live stream (sim IDs/frame) or stay standalone? *(A)*
3. The `siteToPlan` / `siteToTwin` constants. *(A, D)*
4. Source priority `sim > twin > fake`. *(C, A)*
5. LLM provider, key and budget; TTS provider. *(all)*
6. Manual corpus: OSHA public publications plus our fault-code table? *(all)*
7. Protocol wording: Demo site SOP is fine for the demo? *(all)*
8. `src/app/dev/*` pages and the `@web/*` alias. *(D)*
9. §20 shared coordination package: location and owner. *(C, you)*
10. Commit `README copy.md` as README. *(you)*

## §20 V2V plan execution (Phase E): proposal, **awaiting your decision**

**Current state.** Nothing reusable for coordination exists (REPO_ANALYSIS §4):
- no reservations, right-of-way, queues or deadlock handling
- no command channel into the sim
- tasks don't drive motion

**Proposal.**

1. **A shared package `coordination/` at the repo root.** It is pure Python and deterministic, with no I/O and no LLM. Both `simulator` (to execute) and `backend` (to plan, validate and explain) import it. Contents:
   - `resources.py`: lease table for haul-road segments, the loader slot, the fuel bay and zones; lease timeouts.
   - `rules.py`: right-of-way:
     - safety preempts
     - a reversing machine yields
     - loaded beats empty
     - lower plan priority yields
     - deterministic tie-break on `(priority, machine_id)`
   - `queue.py`: FIFO loader queue with ticket numbers.
   - `deadlock.py`: wait-for graph cycle detection; the victim is chosen deterministically.
   - `messages.py`: `v2v_message {kind: request|grant|yield|release, from, to, resource, reason, ts}`.

   **Owner [TEAM TO CONFIRM]:** I propose P2 (me) owns and tests the package, and C integrates it in the sim tick. The alternative is that C owns it and I only consume it.
2. **Sim command channel** (C's `control_api.py`):
   - `POST /machines/{id}/assignment {task_type, zone, route_segments[], window}`
   - `POST /machines/{id}/hold`
   - `POST /machines/{id}/release`
   - `GET /coordination/log`

   The sim applies leases from `coordination` each tick and emits `v2v_message` and `coordination_event` on the stream.
3. **The plan layer is mine** (`backend/copilot/plans/`): model, planner tool, feasibility checker, dispatch, monitoring and replanning, and the E6 tools.

I will not start Phase E until you choose the package owner and C agrees to the command channel.
