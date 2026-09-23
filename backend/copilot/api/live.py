"""WebSocket endpoints: /ws/live (consumers) and /ws/ingest (producers)."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

log = logging.getLogger("copilot.ws")
router = APIRouter()


@router.websocket("/ws/live")
async def ws_live(
    ws: WebSocket, since_rseq: int | None = None, epoch: str | None = None, surface: str | None = None
) -> None:
    hub = ws.app.state.hub
    await ws.accept()
    client = hub.register_client(ws, since_rseq, epoch, surface)
    client.handler = asyncio.current_task()
    client.sender = asyncio.create_task(hub.run_sender(client), name=f"live-sender-{client.cid}")
    try:
        while True:
            # Consumers send nothing today; reading keeps disconnect detection working.
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except asyncio.CancelledError:
        if not client.killed:  # only swallow our own slow-consumer cancellation
            raise
    finally:
        hub.unregister_client(client)


@router.websocket("/ws/ingest")
async def ws_ingest(ws: WebSocket) -> None:
    """Receive-only for Person C's simulator: it never reads its socket, so we never write to it.

    Sources that send `source_hello` with `accepts_control: true` may receive `control` frames.
    """
    hub = ws.app.state.hub
    await ws.accept()
    conn = None
    bad = 0
    try:
        first = json.loads(await ws.receive_text())
        hello = first if isinstance(first, dict) and first.get("type") == "source_hello" else None
        conn = hub.connect_source(ws, hello)
        if hello is None:
            _ingest_any(hub, conn, first)
        while True:
            text = await ws.receive_text()
            try:
                raw = json.loads(text)
            except json.JSONDecodeError:
                bad += 1
                if bad in (1, 10, 100):
                    log.warning("ingest %s: %d undecodable frames", conn.source_id, bad)
                continue
            _ingest_any(hub, conn, raw)
            # Frames already buffered are returned without suspending; yield so the per-client sender
            # tasks can drain during a producer burst (e.g. C's sim replaying its queue after a reconnect).
            await asyncio.sleep(0)
    except WebSocketDisconnect:
        pass
    except json.JSONDecodeError:
        log.warning("ingest: first frame was not JSON; closing")
        await ws.close(code=1003)
    finally:
        if conn is not None:
            hub.disconnect_source(conn)


def _ingest_any(hub, conn, raw) -> None:
    if isinstance(raw, list):  # tolerate batched producers
        for r in raw:
            if isinstance(r, dict):
                hub.ingest(conn, r)
    elif isinstance(raw, dict):
        hub.ingest(conn, raw)
