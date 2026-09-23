"""RealML: Person C's `intelligence` package, called off the event loop with timeouts.

C's functions are synchronous and some are slow (get_anomalies ~0.4-1.7 s, owner_summary ~2.2 s,
run_what_if ~37 s), so every call goes through asyncio.to_thread under asyncio.timeout, and the
expensive read-only ones are TTL-cached.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Any

from copilot.ml.port import MLUnavailable

TIMEOUT_S = {  # per call; slow history reads keep computing in the background and fill the cache
    "owner": 5.0, "estimate": 2.0, "anomalies": 4.0, "maintenance": 2.0, "risk": 1.0, "kpis": 3.0, "profiles": 3.0}


class RealML:
    name = "real"

    def __init__(self) -> None:
        import intelligence  # noqa: F401  (import errors surface in AutoML's probe)

        self._cache: dict[str, tuple[float, Any]] = {}
        self._inflight: dict[str, asyncio.Future] = {}

    async def _call(self, kind: str, fn, *args, ttl: float = 0.0, **kw) -> Any:
        key = f"{kind}:{args}:{sorted(kw.items())}"
        hit = self._cache.get(key)
        if ttl and hit and time.monotonic() - hit[0] < ttl:
            return hit[1]
        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(asyncio.to_thread(fn, *args, **kw))
            self._inflight[key] = task

            def _done(t: asyncio.Future, key: str = key) -> None:
                self._inflight.pop(key, None)
                if ttl and not t.cancelled() and t.exception() is None:
                    self._cache[key] = (time.monotonic(), t.result())  # late results still warm the cache

            task.add_done_callback(_done)
        try:
            async with asyncio.timeout(TIMEOUT_S[kind]):
                return await asyncio.shield(task)
        except TimeoutError as exc:
            raise MLUnavailable(f"{kind} timed out after {TIMEOUT_S[kind]}s (still computing; cached when done)") from exc
        except Exception as exc:  # e.g. OSError: libomp missing for LightGBM
            raise MLUnavailable(f"{kind} failed: {exc!r}") from exc

    async def warm(self) -> None:
        """Start the slow history reads in the background so the first chat turn is fast."""
        from intelligence import get_anomalies, get_maintenance_forecast

        for kind, fn, args in (("anomalies", get_anomalies, (None, 24)), ("maintenance", get_maintenance_forecast, (None,))):
            with contextlib.suppress(MLUnavailable):
                await self._call(kind, fn, *args, ttl=60)

    async def estimate_task(self, features: dict[str, Any]) -> dict[str, Any]:
        from intelligence import predict_task_time

        out = await self._call("estimate", predict_task_time, features)
        return {**out, "provenance": out.get("model", "unknown")}

    async def anomalies(self, machine_id: str | None, since_hours: int, live: list[dict] | None = None) -> dict[str, Any]:
        from intelligence import get_anomalies
        from intelligence.anomaly import MODEL_DIR

        rows = await self._call("anomalies", get_anomalies, machine_id, since_hours, ttl=60)
        forest = (MODEL_DIR / "anomaly_iforest.joblib").exists()
        return {"anomalies": rows, "provenance": "rules+iforest" if forest else "rules",
                "note": "history windows (data-gen), relative to the latest timestamp in the data"}

    async def maintenance(self, machine_id: str | None) -> dict[str, Any]:
        from intelligence import get_maintenance_forecast

        rows = await self._call("maintenance", get_maintenance_forecast, machine_id, ttl=60)
        return {"forecast": rows, "provenance": "extrapolation"}

    async def what_if(self, params: dict[str, Any]) -> dict[str, Any]:
        from intelligence import run_what_if

        out = await asyncio.to_thread(run_what_if, params)  # caller runs this as a background job
        return {**out, "provenance": "headless_sim"}

    async def working_risk(self, **env: Any) -> dict[str, Any]:
        from intelligence import get_working_risk

        return {**await self._call("risk", get_working_risk, **env), "provenance": "rules"}

    async def fleet_kpis(self, world_snapshot: dict[str, Any]) -> dict[str, Any]:
        from intelligence import fleet_kpis

        out = await self._call("kpis", fleet_kpis, world_snapshot)
        return {**out, "provenance": "live+history" if world_snapshot.get("machines") else "history"}

    async def training_profiles(self) -> dict[str, Any]:
        from intelligence import training_profiles

        return {"profiles": await self._call("profiles", training_profiles, ttl=300), "provenance": "history"}

    async def owner_summary(self, days: int) -> dict[str, Any]:
        from intelligence import owner_summary

        return {**await self._call("owner", owner_summary, days, ttl=600), "provenance": "history"}
