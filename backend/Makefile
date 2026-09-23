# Person B backend. Run from backend/.  (uv project; see pyproject.toml)
.PHONY: dev fake-sim sim-hub contracts contracts-check test lint web-check web-test check

dev:            ## hub on :8000
	uv run python -m copilot

fake-sim:       ## fake 10-machine source -> hub (provenance "fake")
	uv run python scripts/fake_sim.py

sim-hub:        ## Person C's real simulator in hub mode (run from repo root venv)
	cd .. && uv run python -m simulator --mode hub --hub ws://localhost:8000/ws/ingest

contracts:      ## regenerate schema.json, manifest.json, web/lib/stream/contracts.gen.ts
	uv run python -m copilot.contracts.codegen write

contracts-check:
	uv run python -m copilot.contracts.codegen check

lint:
	uv run ruff check .

test:
	uv run pytest -q

web-check:      ## typecheck + lint + node tests for my frontend files only
	cd .. && npx tsc --noEmit -p web/lib/stream/tsconfig.json
	cd .. && npx eslint web/lib src/app/dev
	cd .. && node web/lib/stream/test/run-tests.mjs

check: contracts-check lint test web-check
