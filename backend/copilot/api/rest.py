"""Hub REST endpoints (Phase A)."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import re
import secrets
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse

from copilot.contracts.codegen import SCHEMA_PATH
from copilot.contracts.models import CONTRACT_VERSION
from copilot.timeutil import now_iso_s, parse_ts

router = APIRouter()

SNAPSHOT_MAX_BYTES = 150 * 1024
_DATA_URL = re.compile(r"^data:image/(jpeg|jpg|png|webp);base64,(.+)$", re.S)
_SAFE = re.compile(r"^[A-Za-z0-9_.-]+$")


def _hub(request: Request):
    return request.app.state.hub


def _window(frm: str | None, to: str | None, default_s: float = 600.0) -> tuple[float, float]:
    to_s = parse_ts(to) if to else time.time()
    if to and to_s is None:
        raise HTTPException(422, f"bad 'to' timestamp: {to}")
    from_s = parse_ts(frm) if frm else to_s - default_s
    if frm and from_s is None:
        raise HTTPException(422, f"bad 'from' timestamp: {frm}")
    if from_s > to_s:
        raise HTTPException(422, "'from' is after 'to'")
    return from_s, to_s


@router.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True}


@router.get("/api/health")
async def api_health(request: Request) -> dict[str, Any]:
    hub = _hub(request)
    body = hub.health()
    body["stubs"] = getattr(request.app.state, "stubs", [])
    body["features"] = hub.features()
    body["ok"] = body["db"]["ok"]
    return body


@router.get("/api/contract")
async def contract() -> dict[str, Any]:
    return {"version": CONTRACT_VERSION, "schema": json.loads(SCHEMA_PATH.read_text())}


@router.get("/api/fleet")
async def fleet(request: Request) -> dict[str, Any]:
    hub = _hub(request)
    src = hub.active_source()
    return {
        "ts": now_iso_s(),
        "epoch": hub.epoch,
        "source": src.info(True) if src else None,
        "count": len(hub.world.machines),
        "machines": [hub.world.machines[k] for k in sorted(hub.world.machines)],
        "workers": [hub.world.workers[k] for k in sorted(hub.world.workers)],
        "environment": dict(hub.world.environment),
    }


@router.get("/api/snapshot")
async def snapshot(request: Request) -> dict[str, Any]:
    hub = _hub(request)
    return {**hub.snapshot_payload(), "epoch": hub.epoch}


@router.get("/api/machines/{machine_id}/history")
async def machine_history(
    request: Request,
    machine_id: str,
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    limit: int = Query(3600, ge=1, le=20_000),
) -> dict[str, Any]:
    hub = _hub(request)
    if machine_id not in hub.world.machines and not await hub.persister.known_machine(machine_id):
        raise HTTPException(404, f"unknown machine {machine_id}")
    from_s, to_s = _window(frm, to)
    states = await hub.persister.machine_history(machine_id, from_s, to_s, limit)
    return {"machine_id": machine_id, "count": len(states), "states": states}


@router.get("/api/events")
async def events(
    request: Request,
    since_rseq: int | None = None,
    epoch: str | None = None,
    frm: str | None = Query(None, alias="from"),
    to: str | None = None,
    types: str | None = None,
    machine_id: str | None = None,
    limit: int = Query(500, ge=1, le=10_000),
) -> dict[str, Any]:
    hub = _hub(request)
    type_list = [t for t in (types or "").split(",") if t]
    if since_rseq is not None:
        ep = epoch or hub.epoch
        if ep == hub.epoch and hub.ring and hub.ring[0]["rseq"] <= since_rseq + 1:
            out = [
                m for m in hub.ring
                if m["rseq"] > since_rseq and m.get("type") == "event"
                and (not type_list or m.get("event") in type_list)
                and (not machine_id or m.get("machine_id") == machine_id)
            ][:limit]
            return {"epoch": ep, "source": "ring", "count": len(out), "events": out}
        out = await hub.persister.events(
            epoch=ep, since_rseq=since_rseq, types=type_list, machine_id=machine_id, limit=limit
        )
        return {"epoch": ep, "source": "db", "count": len(out), "events": out}
    from_s, to_s = _window(frm, to, default_s=3600)
    out = await hub.persister.events(from_s=from_s, to_s=to_s, types=type_list, machine_id=machine_id, limit=limit)
    return {"epoch": hub.epoch, "source": "db", "count": len(out), "events": out}


@router.post("/api/events", status_code=201)
async def post_event(request: Request) -> dict[str, Any]:
    """Ingest one event (webcam CV). `id` and `ts` are stamped when missing.

    Optional `snapshot`: a `data:image/jpeg;base64,...` URL, at most 150 KB decoded. It is stored
    and the event gets `data.snapshot_url`.
    """
    hub = _hub(request)
    try:
        body = await request.json()
    except json.JSONDecodeError as exc:
        raise HTTPException(422, "body must be JSON") from exc
    if not isinstance(body, dict):
        raise HTTPException(422, "body must be a JSON object")
    snapshot = body.pop("snapshot", None)
    image: bytes | None = None
    ext = "jpg"
    if snapshot is not None:
        m = _DATA_URL.match(snapshot) if isinstance(snapshot, str) else None
        if not m:
            raise HTTPException(422, "snapshot must be a data:image/(jpeg|png|webp);base64 URL")
        try:
            image = base64.b64decode(m.group(2), validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(422, "snapshot is not valid base64") from exc
        if len(image) > SNAPSHOT_MAX_BYTES:
            raise HTTPException(413, f"snapshot is {len(image)} bytes; limit is {SNAPSHOT_MAX_BYTES}")
        ext = "jpg" if m.group(1) in ("jpeg", "jpg") else m.group(1)
    if image is not None:
        snap_dir = request.app.state.settings.snapshot_dir
        snap_dir.mkdir(parents=True, exist_ok=True)
        name = f"{hub.epoch}_{secrets.token_hex(6)}.{ext}"
        await asyncio.to_thread((snap_dir / name).write_bytes, image)
        data = body.get("data") if isinstance(body.get("data"), dict) else {}
        body["data"] = {**data, "snapshot_url": f"/api/cv/snapshots/{name}"}
    published = hub.ingest_webcam_event(body)
    if published is None:
        raise HTTPException(422, hub.webcam_stats.last_warning or "invalid event")
    return {"id": published["id"], "seq": published["seq"], "rseq": published["rseq"], "epoch": hub.epoch,
            "snapshot_url": (published.get("data") or {}).get("snapshot_url")}


@router.get("/api/cv/snapshots/{name}")
async def cv_snapshot(request: Request, name: str) -> FileResponse:
    if not _SAFE.match(name):
        raise HTTPException(404)
    path = request.app.state.settings.snapshot_dir / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path)


@router.get("/api/replay")
async def replay(
    request: Request,
    frm: str = Query(..., alias="from"),
    to: str | None = None,
    machine_ids: str | None = None,
    include: str = "states,workers,events",
    limit: int = Query(50_000, ge=1, le=200_000),
) -> dict[str, Any]:
    """Stored stream for a time window, ordered by source `ts` (for P3's timeline replay)."""
    hub = _hub(request)
    from_s, to_s = _window(frm, to)
    ids = [x for x in (machine_ids or "").split(",") if x] or None
    inc = {x for x in include.split(",") if x} & {"states", "workers", "events"}
    out = await hub.persister.replay(from_s, to_s, ids, inc, limit)
    if ids and "events" in out:
        out["events"] = [e for e in out["events"] if e.get("machine_id") in ids or e.get("machine_id") is None]
    return {"from": frm, "to": to or now_iso_s(), "machine_ids": ids, **out}
