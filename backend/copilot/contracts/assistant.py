"""Assistant SSE event payloads (POST /api/assistant). One model per SSE `event:` name."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Surface = Literal["cab", "command", "owner", "training", "ar"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AssistantRequest(_Strict):
    surface: Surface
    message: str = Field(min_length=1, max_length=2000)
    machine_id: str | None = None
    operator_id: str | None = None
    conversation_id: str | None = None


class SseMeta(_Strict):
    turn_id: str
    surface: Surface
    mode: Literal["live", "cache", "fallback"]
    model: str | None = None


class SseSpecialist(_Strict):
    id: str
    label: str
    routed_by: Literal["rules", "llm", "fallback"]
    confidence: float


class SseStatus(_Strict):
    state: Literal["thinking", "calling_tool", "answering"]


class SseToolCall(_Strict):
    call_id: str
    name: str
    args: dict[str, Any] = Field(default_factory=dict)


class SseToolResult(_Strict):
    call_id: str
    name: str
    ok: bool
    summary: str
    provenance: str
    latency_ms: int


class SseToken(_Strict):
    delta: str


class Citation(_Strict):
    kind: Literal["manual", "protocol"]
    doc_id: str
    title: str
    page: int | None = None
    step: int | None = None
    quote: str
    section: str | None = None  # 1.2.0: regulation section/paragraph, e.g. "1926.651(e)"
    citation: str | None = None  # 1.2.0: full human-readable citation


class SseConfirmRequired(_Strict):
    action_id: str
    tool: str
    args: dict[str, Any] = Field(default_factory=dict)
    summary: str
    expires_at: str


class SseFinal(_Strict):
    text: str
    speak_text: str
    citations: list[Citation] = Field(default_factory=list)
    actions: list[SseConfirmRequired] = Field(default_factory=list)
    grounded: bool


class SseError(_Strict):
    code: str
    message: str
    fallback_used: bool


class SseDone(_Strict):
    pass


SSE_EVENTS: dict[str, type[BaseModel]] = {
    "meta": SseMeta,
    "specialist": SseSpecialist,
    "status": SseStatus,
    "tool_call": SseToolCall,
    "tool_result": SseToolResult,
    "token": SseToken,
    "citation": Citation,
    "confirm_required": SseConfirmRequired,
    "final": SseFinal,
    "error": SseError,
    "done": SseDone,
}

ASSISTANT_MODELS: tuple[type[BaseModel], ...] = (AssistantRequest, *SSE_EVENTS.values())
