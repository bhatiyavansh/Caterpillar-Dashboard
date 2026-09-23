# P2 progress

| Phase | Branch | Status | Gate |
|---|---|---|---|
| 0 Analysis | p2/analysis | done | docs/REPO_ANALYSIS.md |
| 1 Spec | p2/spec | done | docs/P2_SPEC.md |
| A Contracts, hub, stream client | p2/hub | **done** | contracts-check ✅ · ruff ✅ · pytest 30/30 ✅ (load: p95 fan-out 17–18 ms, 0 loss; slow consumer 4008 + lossless resume) · web-check ✅ (tsc, eslint, 12 node tests) · /dev/stream live in headless Chrome ✅ · C's real sim in hub mode verified ✅ |
| B Agent core | p2/agent | **done (live smoke blocked: no API key)** | pytest ✅ (FakeLLM: 13 tools, all confirm paths, timeouts, fallbacks, grounding) · web-check ✅ · `make live-smoke` ❌ fails loudly: no ANTHROPIC_API_KEY |
| C Knowledge, reports, CV | p2/knowledge | **done** | pytest 79/79 ✅ · `make index` ✅ (81 chunks, bge-small local) · `make rag-eval` hit@5 18/18 = 100% ✅ · every safety event → exactly 1 protocol, steps verbatim, OSHA quotes verbatim-checked ✅ · C's live events carry protocols ✅ |
| D Specialist routing | p2/routing | **done** | pytest 86/86 ✅ · router-eval 24/25 = 96% rules-only, p95 overhead 0.07 ms ✅ · LLM-timeout fallback test ✅ |
| E V2V plan execution | — | blocked: awaiting §20 decision | — |
| F Voice + avatar | p2/routing | **partial**: free browser voice (STT+TTS) + 2D avatar + /dev/avatar; no server TTS, no 3D avatar | tsc/eslint ✅; manual browser check pending |
| G Narrator, cache, eval, embed pack | — | not started | — |
| H Hardening | — | not started | — |

## Stubs currently live (501 + X-Stub: 1, listed in /api/health)
Phase E: /api/plans*  ·  Phase F: /api/tts

## Open blockers
- LLM now Groq → Gemini → Anthropic (whichever keys exist in backend/.env). backend/.env is empty on disk → live tests not yet run.
- `libomp` missing → task-time model runs as `planner_fallback`.
