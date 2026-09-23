"""Batched SQLite persistence (aiosqlite).

Writes are buffered in memory and flushed every `flush_s` or `batch` rows with executemany.
States are kept at most once per entity per `state_interval_s`; every event is kept.
A failing database degrades /api/health but never stops the hub.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from pathlib import Path
from typing import Any

import aiosqlite

from copilot.timeutil import parse_ts

log = logging.getLogger("copilot.persist")

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS states (
    machine_id TEXT NOT NULL, ts TEXT, ts_s REAL NOT NULL, hub_ts TEXT, epoch TEXT, seq INTEGER,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS states_mid_ts ON states(machine_id, ts_s);
CREATE INDEX IF NOT EXISTS states_ts ON states(ts_s);
CREATE TABLE IF NOT EXISTS workers (
    worker_id TEXT NOT NULL, ts TEXT, ts_s REAL NOT NULL, hub_ts TEXT, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workers_ts ON workers(ts_s);
CREATE TABLE IF NOT EXISTS events (
    epoch TEXT NOT NULL, rseq INTEGER NOT NULL, seq INTEGER, id TEXT, ts TEXT, ts_s REAL NOT NULL,
    hub_ts TEXT, event TEXT, machine_id TEXT, severity TEXT, source TEXT, payload TEXT NOT NULL,
    PRIMARY KEY (epoch, rseq)
);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts_s);
CREATE INDEX IF NOT EXISTS events_mid_ts ON events(machine_id, ts_s);
"""


class Persister:
    def __init__(self, path: Path, flush_s: float, batch: int, state_interval_s: float) -> None:
        self.path = path
        self.flush_s = flush_s
        self.batch = batch
        self.state_interval_s = state_interval_s
        self._db: aiosqlite.Connection | None = None
        self._states: list[tuple] = []
        self._workers: list[tuple] = []
        self._events: list[tuple] = []
        self._last_state: dict[str, float] = {}
        self._task: asyncio.Task | None = None
        self._wake = asyncio.Event()
        self.rows_written = 0
        self.errors = 0
        self.last_error: str | None = None
        self.last_flush: float | None = None

    @property
    def ok(self) -> bool:
        return self._db is not None and self.errors == 0

    async def start(self) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._db = await aiosqlite.connect(self.path)
            await self._db.executescript(SCHEMA)
            await self._db.commit()
        except Exception as exc:  # degrade, don't crash
            self.errors += 1
            self.last_error = f"open: {exc!r}"
            log.exception("sqlite open failed")
            self._db = None
        self._task = asyncio.create_task(self._loop(), name="persister")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        await self.flush()
        if self._db:
            await self._db.close()
            self._db = None

    # ------------------------------------------------------------------ buffer

    def pending(self) -> int:
        return len(self._states) + len(self._workers) + len(self._events)

    def add_state(self, payload: dict[str, Any], hub_ts: str, epoch: str, seq: int) -> None:
        mid = payload["machine_id"]
        now = time.monotonic()
        if now - self._last_state.get(mid, -1e9) < self.state_interval_s:
            return
        self._last_state[mid] = now
        ts = payload.get("ts")
        self._states.append(
            (mid, ts, parse_ts(ts) or time.time(), hub_ts, epoch, seq, json.dumps(payload))
        )
        self._maybe_wake()

    def add_worker(self, payload: dict[str, Any], hub_ts: str) -> None:
        wid = payload["worker_id"]
        now = time.monotonic()
        key = f"w:{wid}"
        if now - self._last_state.get(key, -1e9) < self.state_interval_s:
            return
        self._last_state[key] = now
        ts = payload.get("ts")
        self._workers.append((wid, ts, parse_ts(ts) or time.time(), hub_ts, json.dumps(payload)))
        self._maybe_wake()

    def add_event(self, published: dict[str, Any]) -> None:
        ts = published.get("ts")
        self._events.append(
            (
                published["epoch"],
                published["rseq"],
                published["seq"],
                published.get("id"),
                ts,
                parse_ts(ts) or time.time(),
                published["hub_ts"],
                published.get("event"),
                published.get("machine_id"),
                published.get("severity"),
                published.get("source"),
                json.dumps(published),
            )
        )
        self._maybe_wake()

    def _maybe_wake(self) -> None:
        if self.pending() >= self.batch:
            self._wake.set()

    async def _loop(self) -> None:
        while True:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=self.flush_s)
            self._wake.clear()
            await self.flush()

    async def flush(self) -> None:
        if not self.pending():
            return
        states, workers, events = self._states, self._workers, self._events
        self._states, self._workers, self._events = [], [], []
        if self._db is None:
            return  # degraded: data is dropped from persistence only (the live stream is unaffected)
        try:
            await self._db.executemany("INSERT INTO states VALUES (?,?,?,?,?,?,?)", states)
            await self._db.executemany("INSERT INTO workers VALUES (?,?,?,?,?)", workers)
            await self._db.executemany(
                "INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", events
            )
            await self._db.commit()
            self.rows_written += len(states) + len(workers) + len(events)
            self.last_flush = time.time()
        except Exception as exc:
            self.errors += 1
            self.last_error = f"flush: {exc!r}"
            log.exception("sqlite flush failed")

    # ------------------------------------------------------------------ queries

    async def _rows(self, sql: str, args: tuple) -> list[Any]:
        if self._db is None:
            return []
        await self.flush()
        async with self._db.execute(sql, args) as cur:
            return list(await cur.fetchall())

    async def machine_history(
        self, machine_id: str, from_s: float, to_s: float, limit: int
    ) -> list[dict[str, Any]]:
        rows = await self._rows(
            "SELECT payload FROM states WHERE machine_id=? AND ts_s BETWEEN ? AND ? ORDER BY ts_s LIMIT ?",
            (machine_id, from_s, to_s, limit),
        )
        return [json.loads(r[0]) for r in rows]

    async def known_machine(self, machine_id: str) -> bool:
        rows = await self._rows("SELECT 1 FROM states WHERE machine_id=? LIMIT 1", (machine_id,))
        return bool(rows)

    async def events(
        self,
        *,
        from_s: float | None = None,
        to_s: float | None = None,
        epoch: str | None = None,
        since_rseq: int | None = None,
        types: list[str] | None = None,
        machine_id: str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        where, args = ["1=1"], []
        if from_s is not None:
            where.append("ts_s >= ?")
            args.append(from_s)
        if to_s is not None:
            where.append("ts_s <= ?")
            args.append(to_s)
        if epoch is not None:
            where.append("epoch = ?")
            args.append(epoch)
        if since_rseq is not None:
            where.append("rseq > ?")
            args.append(since_rseq)
        if types:
            where.append(f"event IN ({','.join('?' * len(types))})")
            args.extend(types)
        if machine_id:
            where.append("machine_id = ?")
            args.append(machine_id)
        order = "rseq" if since_rseq is not None else "ts_s, rseq"
        sql = f"SELECT payload FROM events WHERE {' AND '.join(where)} ORDER BY {order} LIMIT ?"
        rows = await self._rows(sql, (*args, limit))
        return [json.loads(r[0]) for r in rows]

    async def replay(
        self, from_s: float, to_s: float, machine_ids: list[str] | None, include: set[str], limit: int
    ) -> dict[str, Any]:
        out: dict[str, Any] = {}
        remaining = limit
        if "states" in include:
            if machine_ids:
                q = (
                    f"SELECT payload FROM states WHERE ts_s BETWEEN ? AND ? AND machine_id IN "
                    f"({','.join('?' * len(machine_ids))}) ORDER BY ts_s LIMIT ?"
                )
                rows = await self._rows(q, (from_s, to_s, *machine_ids, remaining + 1))
            else:
                rows = await self._rows(
                    "SELECT payload FROM states WHERE ts_s BETWEEN ? AND ? ORDER BY ts_s LIMIT ?",
                    (from_s, to_s, remaining + 1),
                )
            out["states"] = [json.loads(r[0]) for r in rows[:remaining]]
            out["truncated"] = len(rows) > remaining
            remaining -= len(out["states"])
        if "workers" in include:
            rows = await self._rows(
                "SELECT payload FROM workers WHERE ts_s BETWEEN ? AND ? ORDER BY ts_s LIMIT ?",
                (from_s, to_s, max(remaining, 0) + 1),
            )
            out["workers"] = [json.loads(r[0]) for r in rows[: max(remaining, 0)]]
            out["truncated"] = out.get("truncated", False) or len(rows) > max(remaining, 0)
            remaining -= len(out["workers"])
        if "events" in include:
            out["events"] = await self.events(
                from_s=from_s,
                to_s=to_s,
                machine_id=machine_ids[0] if machine_ids and len(machine_ids) == 1 else None,
                limit=10_000,
            )
        return out
