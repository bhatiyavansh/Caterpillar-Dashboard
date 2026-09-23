"""Tool registry: Pydantic inputs, confirmation flag, surface allow-list, specialist tags.

A tool never raises into the agent loop: every outcome is a `ToolResult` (ok / error) with
`provenance`, so the model and the UI always know where a fact came from.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ValidationError

SURFACES = frozenset({"cab", "command", "owner", "training", "ar"})
ALL = SURFACES


@dataclass
class ToolContext:
    hub: Any
    sim: Any
    ml: Any
    records: Any
    actions: Any
    jobs: Any
    surface: str
    machine_id: str | None = None
    operator_id: str | None = None
    extras: dict[str, Any] = field(default_factory=dict)  # Phase C: rag, protocols, reports


@dataclass
class ToolResult:
    ok: bool
    data: Any
    provenance: str
    summary: str
    pending_action: dict[str, Any] | None = None

    def for_model(self) -> dict[str, Any]:
        out: dict[str, Any] = {"ok": self.ok, "provenance": self.provenance, "data": self.data}
        if self.pending_action:
            out["awaiting_confirmation"] = {
                "action_id": self.pending_action["action_id"],
                "summary": self.pending_action["summary"],
                "note": "Nothing has been done yet. Ask the user to confirm (tap Confirm or say 'confirm').",
            }
        return out


Handler = Callable[[ToolContext, BaseModel], Awaitable[ToolResult]]


@dataclass
class Tool:
    name: str
    description: str
    input_model: type[BaseModel]
    handler: Handler  # for confirm tools: the *execute* step, run only after confirmation
    surfaces: frozenset[str] = ALL
    specialists: frozenset[str] = frozenset()
    requires_confirmation: bool = False
    #: confirm tools: validate + describe what will happen, without side effects
    prepare: Callable[[ToolContext, BaseModel], Awaitable[tuple[str, dict[str, Any]]]] | None = None
    timeout_s: float = 3.0

    def schema(self) -> dict[str, Any]:
        s = self.input_model.model_json_schema()
        s.pop("title", None)
        for prop in s.get("properties", {}).values():
            prop.pop("title", None)
        s.setdefault("additionalProperties", False)
        return {"name": self.name, "description": self.description, "input_schema": s}


class ToolRegistry:
    def __init__(self, tools: list[Tool]) -> None:
        self.tools = {t.name: t for t in tools}

    def for_surface(self, surface: str, names: set[str] | None = None) -> list[Tool]:
        return [t for t in self.tools.values() if surface in t.surfaces and (names is None or t.name in names)]

    async def call(self, name: str, raw_input: Any, ctx: ToolContext) -> tuple[ToolResult, int]:
        t0 = time.monotonic()
        tool = self.tools.get(name)
        if tool is None:
            return ToolResult(False, {"error": f"unknown tool {name}"}, "registry", f"unknown tool {name}"), 0
        if ctx.surface not in tool.surfaces:
            return ToolResult(False, {"error": f"{name} is not available on the {ctx.surface} surface"},
                              "registry", "not allowed on this surface"), 0
        try:
            args = tool.input_model.model_validate(raw_input if isinstance(raw_input, dict) else {})
        except ValidationError as exc:
            errs = [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()]
            return ToolResult(False, {"error": "invalid input", "details": errs}, "registry",
                              "invalid tool input"), int((time.monotonic() - t0) * 1000)
        try:
            async with asyncio.timeout(tool.timeout_s):
                if tool.requires_confirmation:
                    assert tool.prepare is not None
                    summary, preview = await tool.prepare(ctx, args)
                    action = await ctx.actions.create(tool.name, args.model_dump(), summary, ctx.surface, preview)
                    result = ToolResult(True, {"status": "awaiting_confirmation", "preview": preview},
                                        "pending_action", summary, pending_action=action)
                else:
                    result = await tool.handler(ctx, args)
        except TimeoutError:
            result = ToolResult(False, {"error": f"{name} timed out after {tool.timeout_s}s"}, "timeout",
                                f"{name} timed out")
        except ToolError as exc:
            result = ToolResult(False, {"error": str(exc)}, exc.provenance, str(exc))
        return result, int((time.monotonic() - t0) * 1000)


class ToolError(Exception):
    """Expected, user-meaningful failure (unknown machine, simulator offline, ...)."""

    def __init__(self, message: str, provenance: str = "tool") -> None:
        super().__init__(message)
        self.provenance = provenance
