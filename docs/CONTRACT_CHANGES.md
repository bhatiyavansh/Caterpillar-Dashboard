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

## 1.1.0 (2026-09-23, Phase B): confirm flow and records

| Addition | Why | Sign-off |
|---|---|---|
| Hub event kinds `action_pending`, `action_confirmed`, `action_cancelled`, `action_failed` (`data`: `action_id`, `tool`, `surface`) | UI can show and clear confirm cards on every screen; confirmed actions are visible site-wide | D ⏳ |
| Hub event kinds `incident_created` (`data.incident_id`), `work_order_created` (`data.work_order_id`), `training_booked` (`data.booking_id`, `slot_id`) | README §10 lists `incident_created`; the others follow the same pattern | D ⏳ C ⏳ |

## 1.2.0 (2026-09-23, Phase C): protocols and citations

| Addition | Why | Sign-off |
|---|---|---|
| `LiveEvent.protocol?` (`ProtocolRef {id, title, severity, steps[], escalation[], source, regulation?{citation, quote}}`) | Every safety event carries its site protocol, attached deterministically by the hub. Steps are verbatim. | D ⏳ A ⏳ |
| `Citation.section?`, `Citation.citation?` | Regulation citations (29 CFR sections have no pages) | D ⏳ |

## 1.3.0 (2026-09-24): screen context and synthetic knowledge

| Addition | Why | Sign-off |
|---|---|---|
| `AssistantRequest.context?` (`AssistantContext {route?, training?}`) | The one global assistant tells the backend which screen it is on. On `/training` it carries `TrainingContext`: the lesson step, the validator's phase and diagnosis, the lesson machine's readings, and the lesson simulator's own alerts and events. The phase and steps passed come from the telemetry validator, never from the LLM. | A ⏳ D ⏳ |
| `Citation.synthetic?` | Passages from the synthetic demo knowledge corpus (`backend/data/synthetic/`) are marked, so the UI can label them as not official documentation | D ⏳ |
