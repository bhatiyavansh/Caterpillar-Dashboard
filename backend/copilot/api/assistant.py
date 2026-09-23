"""Phase B endpoints: assistant (SSE/JSON), confirm/cancel, task estimate, anomalies, what-if."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from copilot.agent.confirm import ActionError
from copilot.agent.tools.definitions import AnomaliesIn, TaskIn, WhatIfIn
from copilot.contracts.assistant import SSE_EVENTS, AssistantRequest

router = APIRouter()


def _sse(name: str, payload: dict[str, Any]) -> str:
    model = SSE_EVENTS[name]
    data = model.model_validate(payload).model_dump(mode="json")  # contract-checked on the way out
    return f"event: {name}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


@router.post("/api/assistant")
async def assistant(request: Request):
    try:
        req = AssistantRequest.model_validate(await request.json())
    except (ValidationError, json.JSONDecodeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    agent = request.app.state.agent
    if "application/json" in request.headers.get("accept", "") and "text/event-stream" not in request.headers.get("accept", ""):
        out = await agent.collect(req)
        return {**out["final"], "turn_id": out["events"][0][1]["turn_id"], "mode": out["events"][0][1]["mode"],
                "events": [{"event": n, "data": p} for n, p in out["events"] if n not in ("token",)]}

    async def gen():
        async for name, payload in agent.run(req):
            yield _sse(name, payload)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/api/actions")
async def list_actions(request: Request, surface: str | None = None) -> dict[str, Any]:
    return {"actions": request.app.state.actions.list(surface)}


@router.post("/api/actions/{action_id}/confirm")
async def confirm_action(request: Request, action_id: str) -> dict[str, Any]:
    try:
        return await request.app.state.actions.confirm(action_id)
    except ActionError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


@router.post("/api/actions/{action_id}/cancel")
async def cancel_action(request: Request, action_id: str) -> dict[str, Any]:
    try:
        return await request.app.state.actions.cancel(action_id)
    except ActionError as exc:
        raise HTTPException(exc.status, str(exc)) from exc


async def _tool(request: Request, name: str, model: type[BaseModel], body: dict[str, Any], surface: str = "command"):
    try:
        model.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors()) from exc
    ctx = request.app.state.context_factory(AssistantRequest(surface=surface, message="(rest)"))
    res, ms = await request.app.state.registry.call(name, body, ctx)
    if not res.ok:
        raise HTTPException(503, {"error": res.data, "provenance": res.provenance})
    return {"data": res.data, "provenance": res.provenance, "latency_ms": ms}


@router.post("/api/tasks/estimate")
async def estimate(request: Request) -> dict[str, Any]:
    return await _tool(request, "predict_task_time", TaskIn, await request.json())


@router.get("/api/anomalies")
async def anomalies(request: Request, machine_id: str | None = None, since_hours: int = 24) -> dict[str, Any]:
    body = {"since_hours": since_hours, **({"machine_id": machine_id} if machine_id else {})}
    return await _tool(request, "get_anomalies", AnomaliesIn, body)


@router.post("/api/whatif")
async def whatif(request: Request) -> dict[str, Any]:
    body = await request.json()
    try:
        params = WhatIfIn.model_validate(body).model_dump(exclude_none=True)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors()) from exc
    return await request.app.state.jobs.submit(params)


@router.get("/api/whatif/{job_id}")
async def whatif_job(request: Request, job_id: str) -> dict[str, Any]:
    job = request.app.state.jobs.get(job_id)
    if job is None:
        raise HTTPException(404, f"unknown job {job_id}")
    return job
