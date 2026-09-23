"""In-memory world: the latest state per entity, active alerts and environment.

The world holds plain dicts exactly as the source sent them (C's shapes), without envelope.
"""

from __future__ import annotations

import time
from typing import Any

from copilot.timeutil import parse_ts

#: A later event of the key kind clears an active alert of the value kind on the same machine.
CLEARS: dict[str, str] = {"seatbelt_fastened": "seatbelt_unfastened"}
#: Severities that make an event an "active alert" (shown in snapshot.active_alerts).
ALERT_SEVERITIES = {"medium", "high", "critical"}
#: Events that only update environment, never become alerts.
ENVIRONMENT_EVENTS = {"weather_change", "working_risk_changed"}


class World:
    def __init__(self, alert_ttl_s: float = 120.0) -> None:
        self.alert_ttl_s = alert_ttl_s
        self.machines: dict[str, dict[str, Any]] = {}
        self.workers: dict[str, dict[str, Any]] = {}
        self._machine_ts: dict[str, float] = {}
        self._worker_ts: dict[str, float] = {}
        # key "event|machine_id" -> (published event incl. envelope, monotonic time added)
        self._alerts: dict[str, tuple[dict[str, Any], float]] = {}
        self.environment: dict[str, Any] = {}

    def clear(self) -> None:
        self.machines.clear()
        self.workers.clear()
        self._machine_ts.clear()
        self._worker_ts.clear()
        self._alerts.clear()
        self.environment.clear()

    # ------------------------------------------------------------------ states

    def apply_machine(self, payload: dict[str, Any]) -> bool:
        """Store if not older than what we have. Returns True when it became the latest."""
        mid = payload["machine_id"]
        ts = parse_ts(payload.get("ts")) or time.time()
        if ts < self._machine_ts.get(mid, float("-inf")):
            return False
        self._machine_ts[mid] = ts
        self.machines[mid] = payload
        return True

    def apply_worker(self, payload: dict[str, Any]) -> bool:
        wid = payload["worker_id"]
        ts = parse_ts(payload.get("ts")) or time.time()
        if ts < self._worker_ts.get(wid, float("-inf")):
            return False
        self._worker_ts[wid] = ts
        self.workers[wid] = payload
        return True

    # ------------------------------------------------------------------ events

    def apply_event(self, published: dict[str, Any]) -> None:
        kind = published.get("event", "")
        mid = published.get("machine_id")
        data = published.get("data") or {}
        if kind == "weather_change":
            self.environment.update({k: data[k] for k in ("weather", "visibility_m", "ground") if k in data})
        elif kind == "working_risk_changed":
            self.environment["working_risk"] = {k: data.get(k) for k in ("score", "level", "reasons")}
        if kind in CLEARS:
            self._alerts.pop(f"{CLEARS[kind]}|{mid}", None)
            return
        if kind in ENVIRONMENT_EVENTS or published.get("severity") not in ALERT_SEVERITIES:
            return
        self._alerts[f"{kind}|{mid}"] = (published, time.monotonic())

    def active_alerts(self) -> list[dict[str, Any]]:
        now = time.monotonic()
        expired = [k for k, (_, t) in self._alerts.items() if now - t > self.alert_ttl_s]
        for k in expired:
            del self._alerts[k]
        return sorted((e for e, _ in self._alerts.values()), key=lambda e: e.get("rseq", 0))

    def machine_ids(self) -> list[str]:
        return sorted(self.machines)
