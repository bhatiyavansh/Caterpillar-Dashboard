"""describe_scene (P2_SPEC §5d): advisory scene description of a CV snapshot. Behind CV_DESCRIBE=1.
Never used for safety decisions: the result is labelled advisory and the safety path never calls it."""

from __future__ import annotations

import asyncio
import os
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from copilot.agent.registry import Tool, ToolContext, ToolError, ToolResult

PROMPT = ("Describe what is visible in this site camera frame in one or two sentences: people, machines, "
          "and their rough positions. Do not judge whether anything is safe or unsafe.")


class DescribeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str = Field(min_length=3, max_length=80, description="Id of a webcam event that has a snapshot")


def enabled() -> bool:
    return os.environ.get("CV_DESCRIBE", "0") == "1"


async def describe_scene(ctx: ToolContext, a: DescribeIn) -> ToolResult:
    if not enabled():
        raise ToolError("describe_scene is disabled (set CV_DESCRIBE=1)", "flag")
    evt = next((e for e in reversed(ctx.hub.ring) if e.get("id") == a.event_id), None)
    url = ((evt or {}).get("data") or {}).get("snapshot_url")
    if not url:
        raise ToolError(f"event {a.event_id} has no camera snapshot", "hub")
    path = ctx.extras["snapshot_dir"] / url.rsplit("/", 1)[-1]
    if not path.is_file():
        raise ToolError("snapshot file missing", "hub")
    image = await asyncio.to_thread(path.read_bytes)
    llm = ctx.extras["llm"]
    text = await llm.describe_image(model=ctx.extras["vision_model"], image=image,
                                    media_type="image/png" if path.suffix == ".png" else "image/jpeg",
                                    prompt=PROMPT, timeout_s=6.0)
    return ToolResult(True, {"advisory": True, "description": text, "event_id": a.event_id,
                             "note": "Advisory only: never a substitute for the safety alert or protocol."},
                      "vision_llm (advisory)", "scene described")


def build_vision_tools() -> list[Tool]:
    return [Tool("describe_scene", "Advisory description of a webcam snapshot attached to an event (people/machines "
                 "visible). Never use it to decide whether something is safe.", DescribeIn, describe_scene,
                 frozenset({"command", "cab"}), frozenset({"safety", "general"}), timeout_s=8.0)]


def as_payload(res: Any) -> dict[str, Any]:  # pragma: no cover - helper for REST if needed later
    return res.for_model()
