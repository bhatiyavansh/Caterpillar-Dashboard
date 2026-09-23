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
