# backend/ — CAT Copilot hub (Person B)

```bash
cd backend
uv sync                      # own venv; path-depends on the repo's simulator + intelligence packages
make dev                     # hub on :8000
make sim-hub                 # Person C's real simulator -> hub   (or: make fake-sim)
make check                   # the gate: contracts-check, ruff, pytest, web checks
```

| URL | What |
|---|---|
| `ws://localhost:8000/ws/live` | consumers: `hello` → `snapshot` → live `machine_state` / `worker_state` / `event` / `heartbeat` (resume: `?since_rseq=N&epoch=E`) |
| `ws://localhost:8000/ws/ingest` | producers (C's sim needs no handshake; others send `source_hello`) |
| `GET /api/health` | sources, clients, seq/rseq, db, **stub list** |
| `GET /api/fleet`, `/api/snapshot` | latest state |
| `GET /api/machines/{id}/history?from&to` | stored states |
| `GET /api/events?since_rseq&epoch` or `?from&to&types&machine_id` | stored/ring events |
| `POST /api/events` | ingest one event (webcam CV); optional `snapshot` data URL ≤150 KB |
| `GET /api/replay?from&to&machine_ids&include` | stored stream window for replay |
| `GET/POST /api/director[/{scenario}]` | proxied to the active source |
| `GET /api/contract` | JSON schema + version |

Everything else in docs/P2_SPEC.md §15 answers `501` with `X-Stub: 1` until its phase lands.
Frontend client: `web/lib/stream` (see HANDOFF.md). Dev page: http://localhost:3000/dev/stream
