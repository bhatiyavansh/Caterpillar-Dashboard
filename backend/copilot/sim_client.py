"""Async HTTP client for Person C's simulator control API (:8100). Every call has a timeout.

We call C's HTTP endpoints directly (async) instead of C's `intelligence.live` wrappers, which
are blocking and swallow errors (a 404 is indistinguishable from "offline" there).
"""

from __future__ import annotations

from typing import Any

import httpx


class SimError(Exception):
    def __init__(self, status: int, detail: Any) -> None:
        super().__init__(f"simulator returned {status}: {detail}")
        self.status = status
        self.detail = detail


class SimUnavailable(Exception):
    pass


class SimClient:
    def __init__(self, base_url: str, timeout_s: float = 2.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=timeout_s)

    async def close(self) -> None:
        await self._client.aclose()

    async def _req(self, method: str, path: str, **kw: Any) -> Any:
        try:
            r = await self._client.request(method, path, **kw)
        except (httpx.TimeoutException, httpx.TransportError) as exc:
            raise SimUnavailable(f"{method} {self.base_url}{path}: {exc!r}") from exc
        if r.status_code >= 400:
            try:
                detail = r.json()
            except ValueError:
                detail = r.text
            raise SimError(r.status_code, detail)
        return r.json()

    async def health(self) -> dict[str, Any]:
        return await self._req("GET", "/health")

    async def scenarios(self) -> list[dict[str, Any]]:
        return await self._req("GET", "/scenarios")

    async def run_scenario(self, name: str, params: dict[str, Any] | None) -> dict[str, Any]:
        return await self._req("POST", f"/scenario/{name}", json=params or None)

    async def state(self) -> dict[str, Any]:
        return await self._req("GET", "/state")

    async def tasks(self, operator_id: str | None = None) -> list[dict[str, Any]]:
        return await self._req("GET", f"/tasks/{operator_id}" if operator_id else "/tasks")

    async def reorder_tasks(self, operator_id: str, reason: str) -> dict[str, Any]:
        return await self._req("POST", f"/tasks/{operator_id}/reorder", params={"reason": reason})
