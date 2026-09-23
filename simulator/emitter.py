"""Getting messages out of the simulator.

Two modes, same message format:

* standalone - the control API serves its own WebSocket at :8100/ws/live, so A
  and D can build against live data before B's hub exists.
* hub        - connect to B's FastAPI hub as a client and push into /ws/ingest.

Both always feed the standalone socket as well, so `/state` and the director UI
keep working no matter which mode is running.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging

log = logging.getLogger("simulator.emitter")

RECONNECT_MIN_S = 1.0
RECONNECT_MAX_S = 15.0
SEND_QUEUE_MAX = 2_000


class StandaloneBroadcaster:
    """Fan-out to every WebSocket client connected to :8100/ws/live."""

    def __init__(self) -> None:
        self._clients: set = set()

    async def register(self, websocket) -> None:
        self._clients.add(websocket)
        log.info("client connected (%d total)", len(self._clients))

    async def unregister(self, websocket) -> None:
        self._clients.discard(websocket)
        log.info("client disconnected (%d left)", len(self._clients))

    @property
    def client_count(self) -> int:
        return len(self._clients)

    async def broadcast(self, messages: list[dict]) -> None:
        if not self._clients or not messages:
            return
        payloads = [json.dumps(m) for m in messages]
        dead = []
        for ws in list(self._clients):
            try:
                for payload in payloads:
                    await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._clients.discard(ws)


class HubClient:
    """Resilient WebSocket client for B's /ws/ingest.

    The simulator must never block or die because the hub is down - messages
    are queued, and a disconnected hub simply drops the backlog.
    """

    def __init__(self, url: str) -> None:
        self.url = url
        self.connected = False
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=SEND_QUEUE_MAX)
        self._task: asyncio.Task | None = None
        self.sent = 0
        self.dropped = 0

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="hub-client")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task

    async def broadcast(self, messages: list[dict]) -> None:
        for m in messages:
            try:
                self._queue.put_nowait(m)
            except asyncio.QueueFull:
                self.dropped += 1

    async def _run(self) -> None:
        import websockets

        delay = RECONNECT_MIN_S
        while True:
            try:
                async with websockets.connect(self.url, ping_interval=20) as ws:
                    self.connected = True
                    delay = RECONNECT_MIN_S
                    log.info("connected to hub at %s", self.url)
                    while True:
                        msg = await self._queue.get()
                        await ws.send(json.dumps(msg))
                        self.sent += 1
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.connected = False
                log.warning("hub connection lost (%s); retrying in %.0fs", exc, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, RECONNECT_MAX_S)


class Emitter:
    """Whatever the mode, the simulator only ever calls `broadcast`."""

    def __init__(self, broadcaster: StandaloneBroadcaster, hub: HubClient | None = None) -> None:
        self.broadcaster = broadcaster
        self.hub = hub

    async def broadcast(self, messages: list[dict]) -> None:
        await self.broadcaster.broadcast(messages)
        if self.hub is not None:
            await self.hub.broadcast(messages)

    def status(self) -> dict:
        return {
            "standalone_clients": self.broadcaster.client_count,
            "hub_url": self.hub.url if self.hub else None,
            "hub_connected": bool(self.hub and self.hub.connected),
            "hub_sent": self.hub.sent if self.hub else 0,
            "hub_dropped": self.hub.dropped if self.hub else 0,
        }
