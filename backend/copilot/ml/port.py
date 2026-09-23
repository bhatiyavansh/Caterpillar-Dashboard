"""ML port: the only way the backend reaches Person C's models.

Every result is a dict carrying `provenance` so nothing stubbed can masquerade as a model output:
  lightgbm_quantile | planner_fallback | rules+iforest | rules | extrapolation | headless_sim | stub
The interface C implements is documented in docs/ML_INTERFACE.md.
"""

from __future__ import annotations

from typing import Any, Protocol


class MLUnavailable(Exception):
    """The requested capability has no real or stub implementation right now."""


class MLPort(Protocol):
    name: str  # "real" | "stub"

    async def estimate_task(self, features: dict[str, Any]) -> dict[str, Any]: ...
    async def anomalies(self, machine_id: str | None, since_hours: int) -> dict[str, Any]: ...
    async def maintenance(self, machine_id: str | None) -> dict[str, Any]: ...
    async def what_if(self, params: dict[str, Any]) -> dict[str, Any]: ...
    async def working_risk(self, **env: Any) -> dict[str, Any]: ...
    async def fleet_kpis(self, world_snapshot: dict[str, Any]) -> dict[str, Any]: ...
    async def training_profiles(self) -> dict[str, Any]: ...
    async def owner_summary(self, days: int) -> dict[str, Any]: ...
