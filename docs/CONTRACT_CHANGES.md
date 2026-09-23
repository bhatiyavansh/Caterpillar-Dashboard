# Contract changes

Every addition to the hub contract (`backend/copilot/contracts`) is logged here with a version bump. `make contracts-check` fails if the manifest changes without a new `## <version>` entry, or if a field is removed or retyped.

The canonical stream payloads (`machine_state`, `worker_state`, `event`) are Person C's `simulator/schemas.py`. The hub imports them and never redefines them, so changes to those payloads are C's to announce. They show up here as "upstream" when the manifest picks them up.

Sign-off column: who has to confirm. ✅ means confirmed, ⏳ means pending.

---

## 1.0.0 (2026-09-23, Phase A): initial hub contract

| Addition | Why | Sign-off |
|---|---|---|
| Envelope `seq`, `epoch`, `hub_ts` on every `/ws/live` message | ordering and restart detection | A ⏳ D ⏳ |
| `rseq` on reliable messages (`event`, `utterance`) | loss detection and resync (`/ws/live?since_rseq=&epoch=`) | A ⏳ D ⏳ |
| `LiveEvent.source_id?` and `LiveEvent.stale?` | provenance; C's sim replays stale bursts after downtime | D ⏳ |
| Messages `hello`, `snapshot`, `heartbeat`, `utterance` | snapshot on connect, liveness, narrator (Phase G) | A ⏳ D ⏳ |
| `source_hello`, `control`, `control_ack` on `/ws/ingest` | optional handshake for non-C sources (twin, fake). **C's sim is unaffected**: it sends no hello and never receives. | C ⏳ A ⏳ |
| Hub event kinds `source_changed`, `low_fuel`, `engine_fault`, `emergency_stop` | the last three come only from the twin source, whose alerts have no C equivalent | D ⏳ |
| Hub-emitted events use C's `source: "rules"` with `data.created_by: "backend"` | C's `Source` enum has no `backend` value; this follows C's `incident_created` fixture precedent | C ⏳ |
| Assistant SSE events `meta`, `specialist`, `status`, `tool_call`, `tool_result`, `token`, `citation`, `confirm_required`, `final`, `error`, `done`, plus `AssistantRequest` | `POST /api/assistant` | D ⏳ |
