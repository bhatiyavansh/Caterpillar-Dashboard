"""Deterministic stub ML. Every output is labelled provenance="stub" and says what it is based on.

Used when Person C's `intelligence` package or its data are unavailable. It never invents a model
prediction: the task estimate is the planner's own estimate carried on the task, and anomalies are
the brief's belt-off + idle rule applied to live machine states.
"""

from __future__ import annotations

from typing import Any

from copilot.ml.port import MLUnavailable


class StubML:
    name = "stub"

    async def estimate_task(self, features: dict[str, Any]) -> dict[str, Any]:
        est = features.get("estimated_time_min")
        if est is None:
            raise MLUnavailable("no model and no planner estimate for this task")
        return {"p10": round(est * 0.85, 1), "p50": round(float(est), 1), "p90": round(est * 1.25, 1),
                "unit": "min", "reasons": [], "provenance": "stub",
                "note": "planner estimate with a fixed ±15/25% band; no ML model available"}

    async def anomalies(self, machine_id: str | None, since_hours: int, live: list[dict] | None = None) -> dict[str, Any]:
        out = []
        for m in live or []:
            if machine_id and m.get("machine_id") != machine_id:
                continue
            if m.get("seatbelt") == "unfastened" and float(m.get("idle_min", 0)) >= 30:
                out.append({"machine_id": m["machine_id"], "type": "excessive_idling",
                            "related": ["seatbelt_violation"], "score": None, "detected_by": "stub_rule",
                            "evidence": {"idle_min": m.get("idle_min"), "seatbelt": "unfastened",
                                         "load_cycles": m.get("load_cycles")}})
        return {"anomalies": out, "provenance": "stub",
                "note": "rule from the brief (belt unfastened and idle >= 30 min) on live states only"}

    async def maintenance(self, machine_id: str | None) -> dict[str, Any]:
        raise MLUnavailable("maintenance forecast needs Person C's history data")

    async def what_if(self, params: dict[str, Any]) -> dict[str, Any]:
        raise MLUnavailable("what-if needs Person C's headless simulator")

    async def working_risk(self, **env: Any) -> dict[str, Any]:
        raise MLUnavailable("working risk needs Person C's risk rules")

    async def fleet_kpis(self, world_snapshot: dict[str, Any]) -> dict[str, Any]:
        machines = world_snapshot.get("machines", [])
        return {"active_machines": sum(1 for m in machines if m.get("engine_on")),
                "total_machines": len(machines), "provenance": "stub",
                "note": "counts from live states only; no history"}

    async def training_profiles(self) -> dict[str, Any]:
        raise MLUnavailable("training profiles need Person C's history data")

    async def owner_summary(self, days: int) -> dict[str, Any]:
        raise MLUnavailable("owner summary needs Person C's history data")
