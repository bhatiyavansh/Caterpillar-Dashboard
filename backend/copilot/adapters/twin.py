"""TwinAdapter: Person A's `UiSnapshot` (sent by web/lib/stream TwinPublisher) -> contract items.

All field/unit/ID mapping lives in `twin_mapping.py`; this class only holds per-connection
state (which twin alerts are open, last swing angle) and emits events on alert appear.
"""

from __future__ import annotations

from typing import Any

from copilot.adapters import twin_mapping as tm
from copilot.adapters.base import AdapterStats, Item, validate_contract_frame
from copilot.timeutil import now_iso_s


class TwinAdapter:
    format = "twin_snapshot"

    def __init__(self) -> None:
        self.stats = AdapterStats()
        self._open_alerts: set[str] = set()
        self._swing: dict[str, float] = {}
        self._n = 0
        self.weather: str | None = None

    def _event_id(self) -> str:
        self._n += 1
        return f"twin_{self._n:06d}"

    def normalize(self, raw: dict[str, Any]) -> list[Item]:
        if raw.get("type") != "twin_snapshot" or not isinstance(raw.get("snapshot"), dict):
            self.stats.unknown_types[str(raw.get("type"))] += 1
            return []
        snap = raw["snapshot"]
        ts = now_iso_s()
        frames: list[dict[str, Any]] = []
        for t in snap.get("machines", []):
            mid = tm.MACHINE_IDS.get(t.get("machineId", ""))
            swing = t.get("swingAngle")
            delta = None
            if mid and swing is not None and mid in self._swing:
                delta = float(swing) - self._swing[mid]
            if mid and swing is not None:
                self._swing[mid] = float(swing)
            payload = tm.machine_payload(t, ts, delta)
            if payload is not None:
                frames.append(payload)
        for w in snap.get("workers", []):
            frames.append(tm.worker_payload(w, ts))

        current = {a["id"]: a for a in snap.get("alerts", []) if "id" in a}
        for aid in sorted(set(current) - self._open_alerts):
            evt = tm.alert_event(current[aid], ts, self._event_id())
            if evt is not None:
                frames.append(evt)
        self._open_alerts = set(current)

        weather = snap.get("weather")
        if weather and weather != self.weather:
            if self.weather is not None:
                frames.append(
                    {
                        "type": "event",
                        "id": self._event_id(),
                        "ts": ts,
                        "event": "weather_change",
                        "severity": "medium" if weather != "clear" else "info",
                        "machine_id": None,
                        "source": "scenario",
                        "message": f"Weather changed to {weather}",
                        "data": {"weather": weather},
                    }
                )
            self.weather = weather

        items: list[Item] = []
        for f in frames:
            items += validate_contract_frame(f, self.stats, "twin")
        return items
