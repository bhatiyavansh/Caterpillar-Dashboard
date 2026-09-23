# P2 progress

| Phase | Branch | Status | Gate |
|---|---|---|---|
| 0 Analysis | p2/analysis | done | docs/REPO_ANALYSIS.md |
| 1 Spec | p2/spec | done | docs/P2_SPEC.md |
| A Contracts, hub, stream client | p2/hub | **done** | contracts-check ✅ · ruff ✅ · pytest 30/30 ✅ (load: p95 fan-out 17–18 ms, 0 loss; slow consumer 4008 + lossless resume) · web-check ✅ (tsc, eslint, 12 node tests) · /dev/stream live in headless Chrome ✅ · C's real sim in hub mode verified ✅ |
| B Agent core | p2/agent | **done (live smoke blocked: no API key)** | pytest ✅ (FakeLLM: 13 tools, all confirm paths, timeouts, fallbacks, grounding) · web-check ✅ · `make live-smoke` ❌ fails loudly: no ANTHROPIC_API_KEY |
| C Knowledge, reports, CV | p2/knowledge | not started | — |
| D Specialist routing | p2/routing | not started | — |
| E V2V plan execution | — | blocked: awaiting §20 decision | — |
| F Voice + avatar | — | not started | — |
| G Narrator, cache, eval, embed pack | — | not started | — |
| H Hardening | — | not started | — |

## Stubs currently live (501 + X-Stub: 1, listed in /api/health)
Phase C: /api/protocols*, /api/rag/search, /api/incidents*, /api/work-orders, /api/reports/weekly
Phase E: /api/plans*  ·  Phase F: /api/tts

## Open blockers
- No `ANTHROPIC_API_KEY` (live smoke tests).
- `libomp` missing → task-time model runs as `planner_fallback`.
