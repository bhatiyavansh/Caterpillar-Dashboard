"""Director: POST /api/director/{scenario} routed to the active source. Never a silent success."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from copilot.config import REPO_DIR
from copilot.sim_client import SimError, SimUnavailable

router = APIRouter()

#: Person D's director IDs -> Person C's scenario names (REPO_ANALYSIS C5)
ALIASES: dict[str, str] = {"worker_proximity": "worker_behind", "heavy_lift_slope": "heavy_lift"}
FIXTURE = REPO_DIR / "fixtures" / "scenarios.json"


def _fixture_scenarios() -> list[dict[str, Any]]:
    try:
        return json.loads(FIXTURE.read_text())
    except (OSError, json.JSONDecodeError):
        return []


def known_scenarios() -> set[str]:
    return {s["name"] for s in _fixture_scenarios()} | {"reset"}


@router.get("/api/director")
async def list_scenarios(request: Request) -> dict[str, Any]:
    hub = request.app.state.hub
    src = hub.active_source()
    if src is not None and src.kind == "sim":
        try:
            return {"routed_to": "sim", "provenance": "live", "aliases": ALIASES,
                    "scenarios": await request.app.state.sim.scenarios()}
        except (SimUnavailable, SimError):
            pass
    return {"routed_to": src.kind if src else None, "provenance": "fixture", "aliases": ALIASES,
            "scenarios": _fixture_scenarios()}


@router.post("/api/director/{scenario}")
async def run_scenario(request: Request, scenario: str) -> dict[str, Any]:
    hub = request.app.state.hub
    name = ALIASES.get(scenario, scenario)
    params: dict[str, Any] | None = None
    raw = await request.body()
    if raw:
        try:
            params = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(422, "params body must be JSON") from exc
        if not isinstance(params, dict):
            raise HTTPException(422, "params body must be a JSON object")
    if name not in known_scenarios():
        raise HTTPException(404, f"unknown scenario '{scenario}'")
    src = hub.active_source()
    if src is None:
        raise HTTPException(503, "no active data source (start the simulator in hub mode, or fake_sim)")

    if src.kind == "sim":
        try:
            result = await request.app.state.sim.run_scenario(name, params)
        except SimUnavailable as exc:
            raise HTTPException(504, f"simulator did not answer: {exc}") from exc
        except SimError as exc:
            raise HTTPException(502, {"simulator_status": exc.status, "detail": exc.detail}) from exc
        return {"ok": bool(result.get("ok", True)), "scenario": name, "requested": scenario,
                "routed_to": "sim", "result": result}

    if not src.accepts_control:
        raise HTTPException(409, f"active source {src.source_id} ({src.kind}) does not accept control")
    try:
        ack = await hub.send_control(src, name, params or {})
    except TimeoutError as exc:
        raise HTTPException(504, f"{src.source_id} did not ack within {hub.s.control_ack_timeout_s}s") from exc
    except ConnectionError as exc:
        raise HTTPException(503, str(exc)) from exc
    if not ack.get("ok"):
        raise HTTPException(502, {"source": src.source_id, "error": ack.get("error")})
    return {"ok": True, "scenario": name, "requested": scenario, "routed_to": src.kind, "ack": ack}
