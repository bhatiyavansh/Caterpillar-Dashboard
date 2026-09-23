"""Confirm flow (P2_SPEC §5.7). A confirm tool never executes directly: it becomes a PendingAction
that a human confirms (tap, or "confirm" matched client-side), within 2 minutes. Confirm is
idempotent; confirmed and cancelled actions emit reliable hub events."""

from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import asdict, dataclass, field
from typing import Any

from copilot.timeutil import now_iso_s

EXPIRY_S = 120.0


class ActionError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


@dataclass
class PendingAction:
    action_id: str
    tool: str
    args: dict[str, Any]
    summary: str
    surface: str
    preview: dict[str, Any]
    created_at: str
    expires_at: str
    expires_mono: float
    status: str = "pending"  # pending | confirmed | cancelled | expired | superseded | failed
    result: dict[str, Any] | None = None
    events: list[str] = field(default_factory=list)

    def public(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("expires_mono")
        return d


class ActionManager:
    def __init__(self, hub: Any, expiry_s: float = EXPIRY_S) -> None:
        self.hub = hub
        self.expiry_s = expiry_s
        self.actions: dict[str, PendingAction] = {}
        self.registry = None  # set by the app (circular: tools need actions, actions need tools)
        self.context_factory = None
        self._locks: dict[str, asyncio.Lock] = {}

    def _event(self, kind: str, severity: str, a: PendingAction, message: str, data: dict | None = None) -> None:
        evt = self.hub.hub_event(kind, severity, message,
                                 {"action_id": a.action_id, "tool": a.tool, "surface": a.surface, **(data or {})},
                                 machine_id=a.args.get("machine_id"))
        a.events.append(evt["id"])

    def _expire(self) -> None:
        now = time.monotonic()
        for a in self.actions.values():
            if a.status == "pending" and now > a.expires_mono:
                a.status = "expired"

    async def create(self, tool: str, args: dict[str, Any], summary: str, surface: str,
                     preview: dict[str, Any]) -> dict[str, Any]:
        self._expire()
        for other in self.actions.values():
            if other.surface == surface and other.status == "pending":
                other.status = "superseded"
        now = time.time()
        a = PendingAction(
            action_id=f"ACT-{secrets.token_hex(4)}", tool=tool, args=args, summary=summary, surface=surface,
            preview=preview, created_at=now_iso_s(now), expires_at=now_iso_s(now + self.expiry_s),
            expires_mono=time.monotonic() + self.expiry_s,
        )
        self.actions[a.action_id] = a
        self._event("action_pending", "info", a, f"Awaiting confirmation: {summary}")
        return a.public()

    def list(self, surface: str | None = None) -> list[dict[str, Any]]:
        self._expire()
        return [a.public() for a in self.actions.values() if surface is None or a.surface == surface]

    def get(self, action_id: str) -> PendingAction:
        self._expire()
        a = self.actions.get(action_id)
        if a is None:
            raise ActionError(404, f"unknown action {action_id}")
        return a

    async def confirm(self, action_id: str) -> dict[str, Any]:
        lock = self._locks.setdefault(action_id, asyncio.Lock())
        async with lock:  # idempotent under concurrent double-taps
            a = self.get(action_id)
            if a.status == "confirmed":
                return a.public()
            if a.status == "expired":
                raise ActionError(410, "action expired (2 minutes); ask again")
            if a.status != "pending":
                raise ActionError(409, f"action is {a.status}")
            tool = self.registry.tools[a.tool]
            ctx = self.context_factory(a.surface)
            args = tool.input_model.model_validate(a.args)
            try:
                async with asyncio.timeout(max(tool.timeout_s, 5.0)):
                    res = await tool.handler(ctx, args)
            except Exception as exc:  # the action did not happen; say so
                a.status = "failed"
                a.result = {"ok": False, "error": repr(exc)}
                self._event("action_failed", "medium", a, f"Action failed: {a.summary}", {"error": repr(exc)})
                raise ActionError(502, f"action failed: {exc!r}") from exc
            a.status = "confirmed" if res.ok else "failed"
            a.result = res.for_model()
            self._event("action_confirmed" if res.ok else "action_failed", "info" if res.ok else "medium", a,
                        f"{'Confirmed' if res.ok else 'Failed'}: {a.summary}")
            return a.public()

    async def cancel(self, action_id: str) -> dict[str, Any]:
        a = self.get(action_id)
        if a.status == "pending":
            a.status = "cancelled"
            self._event("action_cancelled", "info", a, f"Cancelled: {a.summary}")
        elif a.status not in ("cancelled", "superseded", "expired"):
            raise ActionError(409, f"action is {a.status}")
        return a.public()
