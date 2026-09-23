"""The hub: ingest -> normalise -> World -> fan-out to /ws/live clients -> SQLite.

Publishing is synchronous (serialise once, enqueue into every outbox, no awaits), so a slow
client can never stall the others. Each client has its own sender task.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import json
import logging
import secrets
import time
from collections import OrderedDict, deque
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from copilot.adapters.base import AdapterStats, ContractAdapter, Item, SourceAdapter, validate_contract_frame
from copilot.adapters.twin import TwinAdapter
from copilot.config import Settings
from copilot.contracts.models import CONTRACT_VERSION
from copilot.hub.outbox import Outbox
from copilot.hub.persistence import Persister
from copilot.hub.world import World
from copilot.timeutil import now_iso_ms, now_iso_s, parse_ts

log = logging.getLogger("copilot.hub")

WORLD_KINDS = ("sim", "twin", "replay", "fake")
PRIORITY = {"sim": 0, "twin": 1, "replay": 2, "fake": 3}
PROVENANCE = {"sim": "live", "twin": "twin", "replay": "replay", "fake": "fake", "webcam": "live"}
CLOSE_SLOW_CONSUMER = 4008


# --------------------------------------------------------------------------- clients


@dataclass
class LiveClient:
    cid: int
    ws: Any
    outbox: Outbox
    surface: str | None
    connected_at: float = field(default_factory=time.time)
    sent: int = 0
    sender: asyncio.Task | None = None
    handler: asyncio.Task | None = None
    killed: bool = False
    last_progress: float = field(default_factory=time.monotonic)  # last successful send (or connect)


# --------------------------------------------------------------------------- sources


@dataclass
class SourceConn:
    source_id: str
    kind: str
    adapter: SourceAdapter
    accepts_control: bool = False
    ws: Any = None
    connected: bool = True
    since: str = field(default_factory=now_iso_s)
    last_seen_mono: float = field(default_factory=time.monotonic)
    last_seen: str | None = None
    messages: int = 0
    ignored: int = 0
    pending_acks: dict[str, asyncio.Future] = field(default_factory=dict)
    dedupe: OrderedDict = field(default_factory=OrderedDict)

    def info(self, active: bool) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "kind": self.kind,
            "provenance": PROVENANCE.get(self.kind, "live"),
            "connected": self.connected,
            "active": active,
            "since": self.since,
            "last_seen": self.last_seen,
            "messages": self.messages,
        }


class Hub:
    def __init__(self, settings: Settings) -> None:
        self.s = settings
        self.epoch = secrets.token_hex(4)
        self.started_at = time.time()
        self.seq = 0
        self.rseq = 0
        self.ring: deque[dict[str, Any]] = deque(maxlen=settings.ring_size)
        self.world = World(settings.alert_ttl_s)
        self.clients: dict[int, LiveClient] = {}
        self.sources: dict[str, SourceConn] = {}
        self.active_source_id: str | None = None
        self.persister = Persister(
            settings.db_path, settings.persist_flush_s, settings.persist_batch, settings.persist_state_interval_s
        )
        self.webcam_stats = AdapterStats()
        #: advertised in hello, e.g. {"llm": "down", "ml": "stub"}; set by the app as phases land
        self.feature_flags: dict[str, str] = {}
        #: called on every event payload before it is stamped (Phase C: protocol attachment)
        self.event_enrichers: list[Callable[[dict[str, Any]], None]] = []
        #: called after an event is published (narrator, plans, ...)
        self.event_listeners: list[Callable[[dict[str, Any]], None]] = []
        self._cid = itertools.count(1)
        self._cmd = itertools.count(1)
        self._tasks: list[asyncio.Task] = []
        self.counters = {
            "states_published": 0,
            "reliable_published": 0,
            "slow_disconnects": 0,
            "ignored_non_active": 0,
            "dedupe_dropped": 0,
            "stale_events": 0,
            "clients_total": 0,
        }

    # ------------------------------------------------------------------ lifecycle

    async def start(self) -> None:
        await self.persister.start()
        self._tasks = [
            asyncio.create_task(self._heartbeat_loop(), name="heartbeat"),
            asyncio.create_task(self._watchdog_loop(), name="source-watchdog"),
        ]

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await t
        for c in list(self.clients.values()):
            self._kill(c, "shutdown")
        await self.persister.stop()

    # ------------------------------------------------------------------ stamping

    def _stamp(self, payload: dict[str, Any], reliable: bool) -> dict[str, Any]:
        self.seq += 1
        msg = dict(payload)
        msg["seq"] = self.seq
        msg["epoch"] = self.epoch
        msg["hub_ts"] = now_iso_ms()
        if reliable:
            self.rseq += 1
            msg["rseq"] = self.rseq
        return msg

    def _fan_state(self, key: str, msg: dict[str, Any]) -> None:
        text = json.dumps(msg, separators=(",", ":"))
        for c in self.clients.values():
            c.outbox.put_state(key, msg["seq"], text)
        self.counters["states_published"] += 1

    def _fan_reliable(self, msg: dict[str, Any]) -> None:
        text = json.dumps(msg, separators=(",", ":"))
        self.ring.append(msg)
        now = time.monotonic()
        for c in list(self.clients.values()):
            # Over the backlog limit AND no send has completed recently: the client is stuck, not just
            # momentarily behind a producer burst. (A blocked send is also caught by slow_send_timeout_s.)
            if not c.outbox.put_reliable(msg["seq"], text) and now - c.last_progress > self.s.slow_progress_s:
                self._kill(c, "slow consumer: reliable backlog over limit and no progress")
        self.counters["reliable_published"] += 1

    # ------------------------------------------------------------------ publish

    def publish_machine(self, payload: dict[str, Any]) -> None:
        if not self.world.apply_machine(payload):
            self.persister.add_state(payload, now_iso_ms(), self.epoch, self.seq)
            return
        msg = self._stamp(payload, reliable=False)
        self._fan_state(f"m:{payload['machine_id']}", msg)
        self.persister.add_state(payload, msg["hub_ts"], self.epoch, msg["seq"])

    def publish_worker(self, payload: dict[str, Any]) -> None:
        if not self.world.apply_worker(payload):
            return
        msg = self._stamp(payload, reliable=False)
        self._fan_state(f"w:{payload['worker_id']}", msg)
        self.persister.add_worker(payload, msg["hub_ts"])

    def publish_event(self, payload: dict[str, Any], source_id: str | None = None) -> dict[str, Any]:
        evt = dict(payload)
        if source_id:
            evt["source_id"] = source_id
        ts = parse_ts(evt.get("ts"))
        if ts is not None and time.time() - ts > self.s.stale_event_s:
            evt["stale"] = True
            self.counters["stale_events"] += 1
        for enrich in self.event_enrichers:
            try:
                enrich(evt)
            except Exception:
                log.exception("event enricher failed")
        msg = self._stamp(evt, reliable=True)
        self.world.apply_event(msg)
        self._fan_reliable(msg)
        self.persister.add_event(msg)
        for listener in self.event_listeners:
            try:
                listener(msg)
            except Exception:
                log.exception("event listener failed")
        return msg

    def publish_reliable(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Non-event reliable messages (utterance; plan messages later)."""
        msg = self._stamp(payload, reliable=True)
        self._fan_reliable(msg)
        return msg

    def hub_event(self, event: str, severity: str, message: str, data: dict[str, Any],
                  machine_id: str | None = None) -> dict[str, Any]:
        """An event created by the backend itself (C's Source enum has no 'backend')."""
        return self.publish_event(
            {
                "type": "event",
                "id": f"hub_{self.epoch}_{self.rseq + 1}",
                "ts": now_iso_s(),
                "event": event,
                "severity": severity,
                "machine_id": machine_id,
                "source": "rules",
                "message": message,
                "data": {**data, "created_by": "backend"},
            }
        )

    # ------------------------------------------------------------------ snapshot / hello

    def sources_info(self) -> list[dict[str, Any]]:
        return [c.info(c.source_id == self.active_source_id) for c in self.sources.values()]

    def snapshot_payload(self, events_truncated: bool = False) -> dict[str, Any]:
        return {
            "type": "snapshot",
            "ts": now_iso_s(),
            "rseq_at": self.rseq,
            "machines": [self.world.machines[k] for k in sorted(self.world.machines)],
            "workers": [self.world.workers[k] for k in sorted(self.world.workers)],
            "active_alerts": self.world.active_alerts(),
            "environment": dict(self.world.environment),
            "sources": self.sources_info(),
            "events_truncated": events_truncated,
        }

    def features(self) -> dict[str, str]:
        return dict(self.feature_flags)

    def register_client(self, ws: Any, since_rseq: int | None, epoch: str | None,
                        surface: str | None = None) -> LiveClient:
        """Synchronous on purpose: hello + replay + snapshot are queued before any live message."""
        client = LiveClient(next(self._cid), ws, Outbox(self.s.max_pending_reliable), surface)
        replay: list[dict[str, Any]] = []
        truncated = False
        resumed = False
        if since_rseq is not None and epoch == self.epoch:
            oldest = self.ring[0]["rseq"] if self.ring else self.rseq + 1
            if since_rseq >= oldest - 1:
                replay = [m for m in self.ring if m["rseq"] > since_rseq]
                resumed = True
                # replay is backlog by construction: give it headroom so it can't trip the slow-consumer limit
                client.outbox.max_reliable += len(replay) + 2
            elif self.rseq > since_rseq:
                truncated = True
        hello = self._stamp(
            {
                "type": "hello",
                "server": "copilot-hub",
                "contract_version": CONTRACT_VERSION,
                "resumed": resumed,
                "sources": self.sources_info(),
                "features": self.features(),
            },
            reliable=False,
        )
        client.outbox.put_reliable(hello["seq"], json.dumps(hello, separators=(",", ":")))
        for old in replay:
            self.seq += 1
            again = {**old, "seq": self.seq}
            client.outbox.put_reliable(self.seq, json.dumps(again, separators=(",", ":")))
        snap = self._stamp(self.snapshot_payload(truncated), reliable=False)
        client.outbox.put_reliable(snap["seq"], json.dumps(snap, separators=(",", ":")))
        self.clients[client.cid] = client
        self.counters["clients_total"] += 1
        return client

    def unregister_client(self, client: LiveClient) -> None:
        self.clients.pop(client.cid, None)
        if client.sender and not client.sender.done():
            client.sender.cancel()

    def broadcast_snapshot(self) -> None:
        snap = self._stamp(self.snapshot_payload(), reliable=False)
        text = json.dumps(snap, separators=(",", ":"))
        for c in self.clients.values():
            c.outbox.clear_states()
            c.outbox.put_reliable(snap["seq"], text)

    def _kill(self, client: LiveClient, reason: str) -> None:
        if client.killed:
            return
        client.killed = True
        if reason.startswith("slow"):
            self.counters["slow_disconnects"] += 1
            log.warning("disconnecting client %s: %s", client.cid, reason)
        self.clients.pop(client.cid, None)
        if client.sender and not client.sender.done():
            client.sender.cancel()

        async def _close() -> None:
            with contextlib.suppress(Exception):
                async with asyncio.timeout(1.0):
                    await client.ws.close(code=CLOSE_SLOW_CONSUMER, reason=reason[:120])
            if client.handler and not client.handler.done():
                client.handler.cancel()

        asyncio.get_running_loop().create_task(_close())

    async def run_sender(self, client: LiveClient) -> None:
        ob = client.outbox
        try:
            while True:
                await ob.wakeup.wait()
                ob.wakeup.clear()
                for text in ob.drain():
                    async with asyncio.timeout(self.s.slow_send_timeout_s):
                        await client.ws.send_text(text)
                    client.sent += 1
                    client.last_progress = time.monotonic()
        except TimeoutError:
            self._kill(client, "slow consumer: send blocked")
        except asyncio.CancelledError:
            raise
        except Exception:
            # the socket went away; the handler's receive loop cleans up
            self.clients.pop(client.cid, None)

    # ------------------------------------------------------------------ sources

    def connect_source(self, ws: Any, hello: dict[str, Any] | None) -> SourceConn:
        if hello is None:
            source_id, kind, fmt, control = "sim", "sim", "contract", False
        else:
            source_id = str(hello.get("source_id") or hello.get("kind"))
            kind = hello.get("kind", "sim")
            fmt = hello.get("format", "contract")
            control = bool(hello.get("accepts_control"))
        existing = self.sources.get(source_id)
        if existing and existing.connected and existing.ws is not ws:
            source_id = f"{source_id}#{next(self._cmd)}"
            existing = None
        adapter: SourceAdapter = TwinAdapter() if fmt == "twin_snapshot" else ContractAdapter(kind)
        if existing:
            existing.ws, existing.connected, existing.accepts_control = ws, True, control
            existing.last_seen_mono = time.monotonic()
            conn = existing
        else:
            conn = SourceConn(source_id, kind, adapter, control, ws)
            self.sources[source_id] = conn
        log.info("source connected: %s (%s, control=%s)", source_id, kind, control)
        self._recompute_active()
        return conn

    def disconnect_source(self, conn: SourceConn) -> None:
        conn.connected = False
        conn.ws = None
        for fut in conn.pending_acks.values():
            if not fut.done():
                fut.set_exception(ConnectionError("source disconnected"))
        conn.pending_acks.clear()
        log.info("source disconnected: %s", conn.source_id)

    def _alive(self, conn: SourceConn) -> bool:
        return (time.monotonic() - conn.last_seen_mono) < self.s.source_silence_s

    def _recompute_active(self) -> None:
        candidates = [c for c in self.sources.values() if c.kind in WORLD_KINDS and self._alive(c)]
        candidates.sort(key=lambda c: (PRIORITY[c.kind], c.since))
        new = candidates[0].source_id if candidates else None
        if new == self.active_source_id:
            return
        old = self.active_source_id
        self.active_source_id = new
        if new is not None and old is not None:
            self.world.clear()
        log.warning("active source: %s -> %s", old, new)
        self.hub_event(
            "source_changed",
            "medium" if new is None else "info",
            f"Active data source changed from {old or 'none'} to {new or 'none'}",
            {"from": old, "to": new, "kind": self.sources[new].kind if new else None},
        )
        self.broadcast_snapshot()

    def ingest(self, conn: SourceConn, raw: dict[str, Any]) -> None:
        conn.last_seen_mono = time.monotonic()
        conn.last_seen = now_iso_s()
        conn.messages += 1
        t = raw.get("type")
        if t == "control_ack":
            fut = conn.pending_acks.pop(str(raw.get("command_id")), None)
            if fut and not fut.done():
                fut.set_result(raw)
            return
        if t == "source_hello":
            return
        if conn.kind in WORLD_KINDS and self.active_source_id != conn.source_id:
            self._recompute_active()
            if self.active_source_id != conn.source_id:
                conn.ignored += 1
                self.counters["ignored_non_active"] += 1
                return
        for item in conn.adapter.normalize(raw):
            self._apply(conn, item)

    def _apply(self, conn: SourceConn, item: Item) -> None:
        if item.kind == "machine":
            if conn.kind in WORLD_KINDS:
                self.publish_machine(item.payload)
        elif item.kind == "worker":
            if conn.kind in WORLD_KINDS:
                self.publish_worker(item.payload)
        else:
            key = (item.payload.get("id"), item.payload.get("ts"))
            if key in conn.dedupe:
                self.counters["dedupe_dropped"] += 1
                return
            conn.dedupe[key] = None
            if len(conn.dedupe) > 5000:
                conn.dedupe.popitem(last=False)
            self.publish_event(item.payload, conn.source_id)

    def ingest_webcam_event(self, raw: dict[str, Any]) -> dict[str, Any] | None:
        raw = {**raw, "type": "event"}
        raw.setdefault("source", "webcam")
        items = validate_contract_frame(raw, self.webcam_stats, "cv")
        if not items:
            return None
        return self.publish_event(items[0].payload, "webcam")

    def active_source(self) -> SourceConn | None:
        return self.sources.get(self.active_source_id) if self.active_source_id else None

    async def send_control(self, conn: SourceConn, command: str, args: dict[str, Any]) -> dict[str, Any]:
        if not conn.accepts_control or conn.ws is None:
            raise ConnectionError(f"source {conn.source_id} does not accept control")
        command_id = f"cmd_{self.epoch}_{next(self._cmd)}"
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        conn.pending_acks[command_id] = fut
        msg = {"type": "control", "command_id": command_id, "command": command, "args": args,
               "issued_by": "director"}
        try:
            await conn.ws.send_text(json.dumps(msg))
            async with asyncio.timeout(self.s.control_ack_timeout_s):
                return await fut
        finally:
            conn.pending_acks.pop(command_id, None)

    # ------------------------------------------------------------------ loops

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(self.s.heartbeat_s)
            hb = self._stamp(
                {
                    "type": "heartbeat",
                    "last_seq": self.seq,
                    "last_rseq": self.rseq,
                    "clients": len(self.clients),
                    "sources": self.sources_info(),
                },
                reliable=False,
            )
            hb["last_seq"] = hb["seq"]
            self._fan_state("hb", hb)

    async def _watchdog_loop(self) -> None:
        while True:
            await asyncio.sleep(0.5)
            self._recompute_active()

    # ------------------------------------------------------------------ health

    def health(self) -> dict[str, Any]:
        pending = [c.outbox.pending() for c in self.clients.values()]
        return {
            "epoch": self.epoch,
            "uptime_s": round(time.time() - self.started_at, 1),
            "contract_version": CONTRACT_VERSION,
            "seq": self.seq,
            "rseq": self.rseq,
            "ring": {"size": len(self.ring), "max": self.ring.maxlen},
            "clients": {
                "connected": len(self.clients),
                "max_pending_reliable": max((p[0] for p in pending), default=0),
                "max_pending_states": max((p[1] for p in pending), default=0),
            },
            "active_source": self.active_source_id,
            "sources": [
                {**c.info(c.source_id == self.active_source_id), "ignored": c.ignored,
                 "adapter": c.adapter.stats.as_dict()}
                for c in self.sources.values()
            ],
            "webcam": self.webcam_stats.as_dict(),
            "world": {
                "machines": len(self.world.machines),
                "workers": len(self.world.workers),
                "active_alerts": len(self.world.active_alerts()),
            },
            "db": {
                "ok": self.persister.ok,
                "path": str(self.persister.path),
                "rows_written": self.persister.rows_written,
                "pending": self.persister.pending(),
                "errors": self.persister.errors,
                "last_error": self.persister.last_error,
            },
            "counters": dict(self.counters),
        }
