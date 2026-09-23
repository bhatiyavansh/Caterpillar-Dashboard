# P2 progress

| Phase | Branch | Status | Gate |
|---|---|---|---|
| 0 Analysis | p2/analysis | done | docs/REPO_ANALYSIS.md |
| 1 Spec | p2/spec | done | docs/P2_SPEC.md |
| A Contracts, hub, stream client | p2/hub | **done** | contracts-check ✅ · ruff ✅ · pytest 30/30 ✅ (load: p95 fan-out 17–18 ms, 0 loss; slow consumer 4008 + lossless resume) · web-check ✅ (tsc, eslint, 12 node tests) · /dev/stream live in headless Chrome ✅ · C's real sim in hub mode verified ✅ |
| B Agent core | p2/agent | **done** | pytest ✅ (FakeLLM: 19 tools, all confirm paths, timeouts, fallbacks, grounding) · web-check ✅ · `make live-smoke` ✅ 5/5 surfaces against Groq |
| C Knowledge, reports, CV | p2/knowledge | **done** | pytest 79/79 ✅ · `make index` ✅ (81 chunks, bge-small local) · `make rag-eval` hit@5 18/18 = 100% ✅ · every safety event → exactly 1 protocol, steps verbatim, OSHA quotes verbatim-checked ✅ · C's live events carry protocols ✅ |
| D Specialist routing | p2/routing | **done** | pytest 86/86 ✅ · router-eval 24/25 = 96% rules-only, p95 overhead 0.07 ms ✅ · LLM-timeout fallback test ✅ |
| E V2V plan execution | — | blocked: awaiting §20 decision | — |
| F Voice + avatar | p2/routing | **partial**: browser voice (STT+TTS) + 2D avatar + /dev/avatar, now wired into the in-cab assistant; no server TTS, no 3D avatar | tsc/eslint ✅; verified live in-browser ✅ |
| G Narrator, cache, eval, embed pack | — | not started | — |
| H Hardening | — | not started | — |

| I Product integration | main | **done** | one hub socket for dashboard + twin + cab (verified: 1 client per tab) · live by default · CV published to the hub · agent recall tools · 100 pytest + 16 node ✅ |

## Stubs currently live (501 + X-Stub: 1, listed in /api/health)
Phase E: /api/plans*  ·  Phase F: /api/tts

## Open blockers
- `libomp` missing → task-time model runs as `planner_fallback`.

## Resolved
- LLM chain live: Groq → Gemini. Gemini needed `GOOGLE_API_KEY` accepted as an alias for
  `GEMINI_API_KEY`, which is what backend/.env actually holds.
- RAG was running BM25-only because the index had never been built. `make index` → hybrid
  (bm25 + BAAI/bge-small-en-v1.5), `make rag-eval` hit@5 18/18 = 100%.
- macOS re-hides the venv's `.pth` files and CPython 3.13 silently skips hidden `.pth` files,
  so the editable `simulator`/`intelligence` install vanishes at random. `copilot/__init__.py`
  now bootstraps `sys.path`; `make check` passes with the files still hidden.
