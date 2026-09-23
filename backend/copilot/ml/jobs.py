"""What-if jobs. C's run_what_if takes ~37 s, so it never runs inline in a chat turn: it runs as a
background job and results are cached on disk by normalised params (so the demo scenarios can be
pre-warmed with `make prewarm-whatif`)."""

from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
from pathlib import Path
from typing import Any

from copilot.timeutil import now_iso_s


class WhatIfJobs:
    def __init__(self, ml: Any, cache_dir: Path) -> None:
        self.ml = ml
        self.cache_dir = cache_dir
        self.jobs: dict[str, dict[str, Any]] = {}
        self._tasks: dict[str, asyncio.Task] = {}

    @staticmethod
    def key(params: dict[str, Any]) -> str:
        return hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]

    def _cache_path(self, key: str) -> Path:
        return self.cache_dir / f"whatif_{key}.json"

    async def submit(self, params: dict[str, Any]) -> dict[str, Any]:
        key = self.key(params)
        path = self._cache_path(key)
        if path.exists():
            result = json.loads(await asyncio.to_thread(path.read_text))
            return {"job_id": f"cache-{key}", "status": "done", "params": params, "result": result,
                    "cached": True}
        for job in self.jobs.values():
            if job["key"] == key and job["status"] == "running":
                return job
        job_id = f"WIF-{secrets.token_hex(3)}"
        job = {"job_id": job_id, "key": key, "status": "running", "params": params, "started_at": now_iso_s(),
               "result": None, "error": None, "cached": False}
        self.jobs[job_id] = job
        self._tasks[job_id] = asyncio.create_task(self._run(job))
        return job

    async def _run(self, job: dict[str, Any]) -> None:
        try:
            result = await self.ml.what_if(job["params"])
            job.update(status="done", result=result, finished_at=now_iso_s())
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(self._cache_path(job["key"]).write_text, json.dumps(result))
        except Exception as exc:
            job.update(status="failed", error=repr(exc), finished_at=now_iso_s())

    async def wait(self, job_id: str, timeout_s: float) -> dict[str, Any]:
        task = self._tasks.get(job_id)
        if task is not None:
            try:
                async with asyncio.timeout(timeout_s):
                    await asyncio.shield(task)
            except TimeoutError:
                pass
        return self.jobs[job_id]

    def get(self, job_id: str) -> dict[str, Any] | None:
        if job_id.startswith("cache-"):
            path = self._cache_path(job_id[6:])
            if path.exists():
                return {"job_id": job_id, "status": "done", "result": json.loads(path.read_text()), "cached": True}
        return self.jobs.get(job_id)
