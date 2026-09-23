# ML interface: Person C ↔ Person B

_How the backend (`backend/copilot/ml/`) calls your `intelligence` package, and what it needs from it. Written against `intelligence/__init__.py` at `b734951`._

## How I call you

- **Import, not HTTP.** `backend/` is a separate uv project with a path dependency on the repo root, so it imports `intelligence` exactly as you ship it. Nothing of yours is copied or edited.
- **Every call runs off the event loop.** It uses `asyncio.to_thread` under `asyncio.timeout`. Your functions can stay synchronous.
- **Slow reads keep going after a timeout.** A timed-out history read keeps computing in the background and fills a 60 s TTL cache, so the next call is instant. `get_anomalies` and `get_maintenance_forecast` are pre-warmed at hub start.
- **Auto-switch.** Every 60 s the backend probes for `import intelligence` and `data/telemetry.csv`. When both are present it uses **RealML**; otherwise it uses **StubML**, which is labelled `provenance: "stub"`. `/api/health → ml` shows the mode and the reason.
- **Per-call fallback.** If a real call fails (timeout, exception, missing `libomp`), that one call falls back to the stub. Its provenance then reads `stub (real failed: …)`.

| Backend port method | Your function | Timeout | Cache | Provenance I report |
|---|---|---|---|---|
| `estimate_task(features)` | `predict_task_time(task: dict)` | 2 s | — | your `model` field: `lightgbm_quantile` or `planner_fallback` |
| `anomalies(machine_id, since_hours)` | `get_anomalies(machine_id, since_hours)` | 4 s | 60 s | `rules+iforest` if `models/anomaly_iforest.joblib` exists, else `rules` |
| `maintenance(machine_id)` | `get_maintenance_forecast(machine_id)` | 2 s | 60 s | `extrapolation` |
| `what_if(params)` | `run_what_if(params)` | background job | disk, by params | `headless_sim` |
| `working_risk(**env)` | `get_working_risk(**env)` | 1 s | — | `rules` |
| `fleet_kpis(snapshot)` | `fleet_kpis(world_snapshot)`; I pass `{machines, environment, recent_events}` from the hub | 3 s | — | `live+history` |
| `training_profiles()` | `training_profiles()` | 3 s | 300 s | `history` |

## Features I assemble for `predict_task_time`

Your simulator tasks carry only `task_type`, `volume_m3`, `soil` and `estimate`. The tool `predict_task_time(task_id)` adds:

- `estimated_time_min` = `task.estimate.p50`
- `machine_model` from `simulator.config.FLEET`
- `operator_skill` and `operator_years` from `simulator.config.OPERATORS`
- `weather` and `visibility_m` from the hub's environment, taken from your `weather_change` events

Every feature I could not supply is listed in the tool result as `features_defaulted`:

- `temperature_c`
- `site_congestion`
- `time_of_day`
- `machine_health`

**Remaining time.** It is computed as `estimate × (1 − progress)`, the same as your `predict_remaining`.

## What would make it better (asks, not blockers)

1. **Anomaly flood.** Gate live forest-only hits in `score_live_window`. It emits ~158 `unusual_pattern` events per 30 sim-minutes. I currently suppress `unusual_pattern` with `window_min == 1` in `get_recent_events`, and count it as `suppressed_live_unusual_pattern`.
2. **`models_available()` vs `libomp`.** Should return False when `lightgbm` can't import. Today, trained `.txt` files plus a missing `libomp` make `predict_task_time` raise `OSError`. I catch it and fall back to the labelled stub.
3. **Stable anomaly IDs.** Numbering restarts per call. I key explanations on `machine_id|type|window.start`.
4. **`fleet_kpis`.** When passed a snapshot without environment, `working_risk` stays the hard-coded 42/medium.
5. **Optional.** A `predict_task_time_for(task_id)` that assembles the features itself would remove my feature-assembly code.

## Status on this Mac (2026-09-23)

- **Data and anomaly model:** data generated; `anomaly_iforest.joblib` trained.
- **Task time:** LightGBM isn't trained because `libomp` is missing, so `task_time` = `planner_fallback` (no SHAP reasons). `brew install libomp && uv run python -m intelligence.train` fixes it, and my port picks the real model up within 60 s.
