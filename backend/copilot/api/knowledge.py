"""Phase C endpoints: protocols, manual search, incidents, work orders, weekly report."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from copilot.agent.tools.definitions import IncidentIn, WorkOrderIn
from copilot.contracts.assistant import AssistantRequest

router = APIRouter()


@router.get("/api/protocols")
async def protocols(request: Request) -> dict[str, Any]:
    return {"protocols": request.app.state.protocols.list()}


@router.get("/api/protocols/{protocol_id}")
async def protocol(request: Request, protocol_id: str) -> dict[str, Any]:
    p = request.app.state.protocols.by_id.get(protocol_id)
    if p is None:
        raise HTTPException(404, f"unknown protocol {protocol_id}")
    return {**p.ref(), "applies_to_events": list(p.applies_to_events), "match": p.match, "roles": list(p.roles)}


@router.get("/api/rag/search")
async def rag_search(request: Request, q: str, k: int = 5) -> dict[str, Any]:
    rag = request.app.state.extras.get("rag")
    if rag is None:
        raise HTTPException(503, "manual index not built: run `make index`")
    import asyncio

    return await asyncio.to_thread(rag.search, q, k)


@router.post("/api/incidents", status_code=201)
async def create_incident(request: Request) -> dict[str, Any]:
    """Direct REST path (e.g. a supervisor form). The agent's create_incident tool goes through the
    confirm flow instead; this endpoint IS the explicit human action, so it files immediately."""
    body = IncidentIn.model_validate(await request.json())
    ctx = request.app.state.context_factory(AssistantRequest(surface="command", message="(rest)"))
    res, _ = await request.app.state.registry.call("create_incident", body.model_dump(), ctx)
    if not res.ok:
        raise HTTPException(422, res.data)
    return await request.app.state.actions.confirm(res.pending_action["action_id"])


@router.get("/api/incidents")
async def list_incidents(request: Request, machine_id: str | None = None, limit: int = 50) -> dict[str, Any]:
    return {"incidents": await request.app.state.records.list("incident", limit, machine_id)}


@router.get("/api/incidents/{incident_id}")
async def get_incident(request: Request, incident_id: str) -> dict[str, Any]:
    rec = await request.app.state.records.get(incident_id)
    if rec is None or rec.get("kind") != "incident":
        raise HTTPException(404, f"unknown incident {incident_id}")
    return rec


@router.post("/api/work-orders", status_code=201)
async def create_work_order(request: Request) -> dict[str, Any]:
    body = WorkOrderIn.model_validate(await request.json())
    ctx = request.app.state.context_factory(AssistantRequest(surface="command", message="(rest)"))
    res, _ = await request.app.state.registry.call("create_work_order", body.model_dump(), ctx)
    if not res.ok:
        raise HTTPException(422, res.data)
    return await request.app.state.actions.confirm(res.pending_action["action_id"])


@router.get("/api/work-orders")
async def list_work_orders(request: Request, machine_id: str | None = None, limit: int = 50) -> dict[str, Any]:
    return {"work_orders": await request.app.state.records.list("work_order", limit, machine_id)}


@router.get("/api/reports/weekly")
async def weekly(request: Request, refresh: bool = False) -> dict[str, Any]:
    reports = request.app.state.reports
    cached = None if refresh else await reports.weekly()
    return cached or await reports.build_weekly()
