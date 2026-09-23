"""Honest stubs: every endpoint from P2_SPEC §15 that is not built yet answers 501 + `X-Stub: 1`
and is listed in /api/health. When a phase lands, its routes are registered for real and the
matching entry disappears from this list automatically (a real route with the same method+path wins).
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.routing import Route

#: (method, path, phase that will implement it)
PLANNED: list[tuple[str, str, str]] = [
    ("POST", "/api/assistant", "B"),
    ("GET", "/api/actions", "B"),
    ("POST", "/api/actions/{action_id}/confirm", "B"),
    ("POST", "/api/actions/{action_id}/cancel", "B"),
    ("POST", "/api/tasks/estimate", "B"),
    ("GET", "/api/anomalies", "B"),
    ("POST", "/api/whatif", "B"),
    ("GET", "/api/whatif/{job_id}", "B"),
    ("GET", "/api/protocols", "C"),
    ("GET", "/api/protocols/{protocol_id}", "C"),
    ("GET", "/api/rag/search", "C"),
    ("POST", "/api/incidents", "C"),
    ("GET", "/api/incidents", "C"),
    ("GET", "/api/incidents/{incident_id}", "C"),
    ("POST", "/api/work-orders", "C"),
    ("GET", "/api/work-orders", "C"),
    ("GET", "/api/reports/weekly", "C"),
    ("POST", "/api/tts", "F"),
    ("POST", "/api/plans", "E"),
    ("GET", "/api/plans", "E"),
    ("GET", "/api/plans/{plan_id}", "E"),
    ("POST", "/api/plans/{plan_id}/confirm", "E"),
    ("POST", "/api/plans/{plan_id}/pause", "E"),
    ("POST", "/api/plans/{plan_id}/resume", "E"),
    ("POST", "/api/plans/{plan_id}/cancel", "E"),
    ("GET", "/api/plans/{plan_id}/timeline", "E"),
]


def _implemented(app: FastAPI) -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    for r in app.router.routes:
        if isinstance(r, Route) and r.methods:
            for m in r.methods:
                out.add((m, r.path))
    return out


def _make_stub(method: str, path: str, phase: str):
    async def _stub() -> JSONResponse:
        return JSONResponse(
            status_code=501,
            headers={"X-Stub": "1"},
            content={
                "stub": True,
                "detail": f"{method} {path} is not implemented yet",
                "planned_phase": phase,
                "spec": "docs/P2_SPEC.md §15",
            },
        )

    return _stub


def register_stubs(app: FastAPI) -> list[dict[str, str]]:
    """Call after all real routers are included. Returns the live stub list."""
    real = _implemented(app)
    stubs: list[dict[str, str]] = []
    for method, path, phase in PLANNED:
        if (method, path) in real:
            continue
        stubs.append({"method": method, "path": path, "phase": phase})

        app.add_api_route(path, _make_stub(method, path, phase), methods=[method], include_in_schema=True, name=f"stub:{method}:{path}")
    app.state.stubs = stubs
    return stubs
