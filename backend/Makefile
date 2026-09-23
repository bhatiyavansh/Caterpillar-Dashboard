# Person B backend. Run from backend/.  (uv project; see pyproject.toml)
.PHONY: dev fake-sim sim-hub contracts contracts-check test lint web-check check live-smoke unhide

unhide:         ## macOS sets UF_HIDDEN on .pth files here (iCloud/Desktop sync); Python 3.13's
                ## site.py silently SKIPS hidden .pth files, so the editable `simulator`/`intelligence`
                ## imports vanish and everything fails with ModuleNotFoundError. Clearing it is cheap.
	@chflags nohidden .venv/lib/*/site-packages/*.pth 2>/dev/null || true

dev: unhide     ## hub on :8000
	uv run python -m copilot

fake-sim:       ## fake 10-machine source -> hub (provenance "fake")
	uv run python scripts/fake_sim.py

sim-hub:        ## Person C's real simulator in hub mode (run from repo root venv)
	cd .. && uv run python -m simulator --mode hub --hub ws://localhost:8000/ws/ingest

contracts:      ## regenerate schema.json, manifest.json, web/lib/stream/contracts.gen.ts
	uv run python -m copilot.contracts.codegen write

contracts-check: unhide
	uv run python -m copilot.contracts.codegen check

lint: unhide
	uv run ruff check .

test: unhide
	uv run pytest -q

web-check:      ## typecheck + lint + node tests for my frontend files only
                ## --no-install: without it, npx silently downloads an unrelated `tsc` package
                ## from the registry when node_modules is missing, and "passes".
	@test -x ../node_modules/.bin/tsc || { echo "run 'npm install' at the repo root first"; exit 1; }
	cd .. && npx --no-install tsc --noEmit -p web/lib/stream/tsconfig.json
	cd .. && npx --no-install eslint web/lib web/components/avatar src/app/dev
	cd .. && node web/lib/stream/test/run-tests.mjs

check: contracts-check lint test web-check

live-smoke:     ## one real LLM question per surface (network; needs a provider key in .env)
	uv run pytest -o addopts="" -m live -s tests/test_live_llm.py

index:          ## build the manual RAG index (downloads the small embedding model once)
	uv run python scripts/build_index.py

rag-eval:       ## demo questions must hit@5 = 100%
	uv run python scripts/rag_eval.py

router-eval:    ## 25 labelled questions: confusion table, accuracy, overhead
	uv run python scripts/router_eval.py
