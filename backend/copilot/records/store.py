"""Records created by the backend: pending actions, incidents, work orders, training bookings.

Separate aiosqlite connection to the hub's database file (WAL mode). IDs are distinct from Person C's
historical ones (INC-0001..0150): live records use INC-YYYYMMDD-NNN, WO-..., BK-....
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiosqlite

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT,
    machine_id TEXT, payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS records_kind ON records(kind, created_at);
"""
PREFIX = {"incident": "INC", "work_order": "WO", "booking": "BK", "action": "ACT"}


class RecordStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._db: aiosqlite.Connection | None = None

    async def start(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self.path)
        await self._db.executescript(SCHEMA)
        await self._db.commit()

    async def stop(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    async def _next_id(self, kind: str) -> str:
        day = datetime.now(UTC).strftime("%Y%m%d")
        prefix = f"{PREFIX[kind]}-{day}-"
        async with self._db.execute("SELECT COUNT(*) FROM records WHERE id LIKE ?", (prefix + "%",)) as cur:
            (n,) = await cur.fetchone()
        return f"{prefix}{n + 1:03d}"

    async def create(self, kind: str, payload: dict[str, Any], status: str = "open") -> dict[str, Any]:
        rid = await self._next_id(kind)
        now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        rec = {"id": rid, "kind": kind, "created_at": now, "status": status, **payload}
        await self._db.execute(
            "INSERT INTO records VALUES (?,?,?,?,?,?)",
            (rid, kind, now, status, payload.get("machine_id"), json.dumps(rec)),
        )
        await self._db.commit()
        return rec

    async def update(self, rid: str, **changes: Any) -> dict[str, Any] | None:
        rec = await self.get(rid)
        if rec is None:
            return None
        rec.update(changes)
        await self._db.execute("UPDATE records SET status=?, payload=? WHERE id=?",
                               (rec.get("status"), json.dumps(rec), rid))
        await self._db.commit()
        return rec

    async def get(self, rid: str) -> dict[str, Any] | None:
        async with self._db.execute("SELECT payload FROM records WHERE id=?", (rid,)) as cur:
            row = await cur.fetchone()
        return json.loads(row[0]) if row else None

    async def list(self, kind: str, limit: int = 100, machine_id: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT payload FROM records WHERE kind=?"
        args: list[Any] = [kind]
        if machine_id:
            sql += " AND machine_id=?"
            args.append(machine_id)
        sql += " ORDER BY created_at DESC, id DESC LIMIT ?"
        async with self._db.execute(sql, (*args, limit)) as cur:
            return [json.loads(r[0]) for r in await cur.fetchall()]
