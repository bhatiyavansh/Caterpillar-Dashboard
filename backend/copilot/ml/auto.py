"""AutoML: real when Person C's package and data are present, else stub; re-probed every 60 s so the
backend switches to real models as soon as C's data/models land, without a restart. Per call, a real
failure (timeout, missing libomp, ...) falls back to the stub and says so in `provenance`."""

from __future__ import annotations

import time
from typing import Any

from copilot.config import REPO_DIR
from copilot.ml.port import MLUnavailable
from copilot.ml.stub import StubML

PROBE_EVERY_S = 60.0


class AutoML:
    def __init__(self, mode: str = "auto") -> None:
        self.mode = mode  # auto | real | stub
        self.stub = StubML()
        self.real = None
        self.reason = "not probed"
        self._probed = 0.0
        self.probe()

    @property
    def name(self) -> str:
        return "real" if self.real is not None else "stub"

    def probe(self) -> None:
        self._probed = time.monotonic()
        if self.mode == "stub":
            self.real, self.reason = None, "ML_MODE=stub"
            return
        if not (REPO_DIR / "data" / "telemetry.csv").exists():
            self.real, self.reason = None, "data/telemetry.csv missing (run data-gen/generate.py)"
            return
        try:
            from copilot.ml.real import RealML

            self.real, self.reason = RealML(), "intelligence package + data present"
        except Exception as exc:
            self.real, self.reason = None, f"intelligence import failed: {exc!r}"

    def status(self) -> dict[str, Any]:
        from copilot.ml.real import TIMEOUT_S

        task_model = "unknown"
        try:
            from intelligence.task_time import models_available

            task_model = "lightgbm_quantile" if models_available() else "planner_fallback (no trained model)"
        except Exception as exc:
            task_model = f"unavailable: {exc!r}"
        return {"mode": self.name, "configured": self.mode, "reason": self.reason, "task_time": task_model,
                "timeouts_s": TIMEOUT_S}

    async def _dispatch(self, method: str, *args: Any, **kw: Any) -> dict[str, Any]:
        if time.monotonic() - self._probed > PROBE_EVERY_S:
            self.probe()
        if self.real is not None:
            try:
                return await getattr(self.real, method)(*args, **kw)
            except MLUnavailable as exc:
                out = await getattr(self.stub, method)(*args, **kw)
                return {**out, "provenance": f"stub (real failed: {exc})"}
        return await getattr(self.stub, method)(*args, **kw)

    async def estimate_task(self, features):
        return await self._dispatch("estimate_task", features)

    async def anomalies(self, machine_id, since_hours=24, live=None):
        return await self._dispatch("anomalies", machine_id, since_hours, live=live)

    async def maintenance(self, machine_id):
        return await self._dispatch("maintenance", machine_id)

    async def what_if(self, params):
        return await self._dispatch("what_if", params)

    async def working_risk(self, **env):
        return await self._dispatch("working_risk", **env)

    async def fleet_kpis(self, world_snapshot):
        return await self._dispatch("fleet_kpis", world_snapshot)

    async def training_profiles(self):
        return await self._dispatch("training_profiles")

    async def owner_summary(self, days=7):
        return await self._dispatch("owner_summary", days)
