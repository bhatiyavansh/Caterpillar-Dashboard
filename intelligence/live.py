"""Thin wrappers over the simulator's control API.

B's backend imports these and wraps them as agent tools.  They are deliberately
thin - all the logic lives in the simulator; this is just HTTP.  Every call has
a short timeout and degrades to an empty result rather than raising, so the
agent never hangs because the simulator is restarting.
"""

from __future__ import annotations

import os

import httpx

BASE_URL = os.environ.get("SIMULATOR_URL", "http://localhost:8100")
TIMEOUT_S = 2.0


def _get(path: str, default):
    try:
        r = httpx.get(f"{BASE_URL}{path}", timeout=TIMEOUT_S)
        r.raise_for_status()
        return r.json()
    except Exception:
        return default


def _post(path: str, default, **params):
    try:
        r = httpx.post(f"{BASE_URL}{path}", params=params, timeout=TIMEOUT_S)
        r.raise_for_status()
        return r.json()
    except Exception:
        return default


def simulator_online() -> bool:
    return bool(_get("/health", {}).get("ok"))


def get_machine_status(machine_id: str) -> dict:
    """Latest `machine_state` for one machine."""
    return _get(f"/machines/{machine_id}", {})


def get_fleet_overview() -> dict:
    """Every latest state plus the KPI bar."""
    snapshot = _get("/state", {})
    machines = snapshot.get("machines", [])
    from .summaries import fleet_kpis

    return {
        "ts": snapshot.get("ts"),
        "environment": snapshot.get("environment", {}),
        "machines": machines,
        "workers": snapshot.get("workers", []),
        "kpis": fleet_kpis(snapshot if machines else None),
        "active_scenarios": snapshot.get("active_scenarios", []),
    }


def get_shift_tasks(operator_id: str) -> list[dict]:
    """This operator's tasks for the shift, in current order."""
    return _get(f"/tasks/{operator_id}", [])


def reorder_tasks(operator_id: str, reason: str) -> dict:
    """Resequence an operator's tasks and emit `task_reordered`."""
    return _post(f"/tasks/{operator_id}/reorder", {}, reason=reason)


def get_recent_events(limit: int = 50) -> list[dict]:
    return _get(f"/events?limit={limit}", [])


def trigger_scenario(name: str) -> dict:
    """Used by B's /api/director/{scenario} proxy."""
    return _post(f"/scenario/{name}", {"ok": False, "scenario": name})
