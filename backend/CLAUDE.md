# backend/ — P2 / Person B ("The Brain")

Before any task, read docs/P2_SPEC.md, docs/REPO_ANALYSIS.md and docs/P2_PROGRESS.md.

- Scope: `README copy.md` (the real README; §10 stream contract). VISION.md only where P2_SPEC pulls it in.
- I write only in `backend/**`, `web/lib/stream/**`, `web/lib/assistant/**`, `web/components/avatar/**`, `src/app/dev/**`, `docs/P2_*`, `docs/REPO_ANALYSIS.md`, `docs/ML_INTERFACE.md`, `docs/CONTRACT_CHANGES.md`, `HANDOFF.md`. Teammates' code (simulator/, intelligence/, src/**, web/components/cv/, root configs) gets snippets, never edits.
- Python: `cd backend && uv run ...` (separate uv project; path-depends on the root `cat-copilot` package for `simulator.schemas` and `intelligence`).
- Canonical stream payloads are C's `simulator.schemas`; never redefine them. Envelope/hub messages live in `copilot/contracts`. Every contract addition → bump `CONTRACT_VERSION` + entry in docs/CONTRACT_CHANGES.md, then `make contracts`.
- Quality bar (P2_SPEC §1): async only; timeout + fallback on every network/LLM/TTS call; safety deterministic, never LLM; facts from data/documents only; tests never hit the network; no silent stubs (provenance + X-Stub + /api/health); never weaken a test.
- A phase is done when its §18 gate passes, it is committed on `p2/<phase>`, and "SEND TO TEAMMATES" is appended to HANDOFF.md. Update docs/P2_PROGRESS.md.
