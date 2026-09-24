"""Assistant SSE event payloads (POST /api/assistant). One model per SSE `event:` name."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Surface = Literal["cab", "command", "owner", "training", "ar"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TrainingTelemetry(_Strict):
    """1.3.0: the lesson machine's readings (browser simulator), rounded for the prompt."""

    speed_kmh: float | None = None
    heading_deg: float | None = None
    swing_deg: float | None = None
    boom_deg: float | None = None
    nearest_person_m: float | None = None
    tip_over_margin: float | None = None
    hydraulic_temp_c: float | None = None
    activity: str | None = Field(None, max_length=40)
    emergency_stopped: bool | None = None


class TrainingAlert(_Strict):
    """1.3.0: an alert the lesson simulator's own deterministic rules raised."""

    kind: str = Field(max_length=40)
    severity: str = Field(max_length=20)
    title: str = Field(max_length=120)
    message: str = Field(max_length=300)


class TrainingEventNote(_Strict):
    """1.3.0: one line of the lesson simulator's event log."""

    time: str = Field(max_length=20)
    text: str = Field(max_length=200)
    severity: str = Field(max_length=20)


class TrainingLearner(_Strict):
    name: str = Field(max_length=60)
    level: str = Field(max_length=30)
    weakest_skill: str | None = Field(None, max_length=40)


class TrainingContext(_Strict):
    """1.3.0: where the trainee is. Every verdict here (phase, steps passed) comes from the lesson's
    telemetry validator, never from a language model."""

    lesson_active: bool = False
    phase: Literal["idle", "running", "passed", "retrying", "levelDone", "finished"] | None = None
    module_id: str | None = Field(None, max_length=60)
    module_title: str | None = Field(None, max_length=120)
    skill: str | None = Field(None, max_length=40)
    module_index: int | None = None
    module_count: int | None = None
    step_id: str | None = Field(None, max_length=60)
    step_instruction: str | None = Field(None, max_length=400)
    real_control: str | None = Field(None, max_length=200)
    keys: list[str] = Field(default_factory=list, max_length=6)
    step_index: int | None = None
    step_count: int | None = None
    attempt: int | None = None
    #: the validator's diagnosis of the last failed attempt
    last_failure_reason: str | None = Field(None, max_length=300)
    #: the coach's latest line on screen
    coach_line: str | None = Field(None, max_length=400)
    steps_passed: int | None = None
    levels_passed: list[str] = Field(default_factory=list, max_length=20)
    next_level: str | None = Field(None, max_length=120)
    learner: TrainingLearner | None = None
    machine_source: Literal["lesson_sim", "live_hub"] | None = None
    telemetry: TrainingTelemetry | None = None
    alerts: list[TrainingAlert] = Field(default_factory=list, max_length=6)
    recent_events: list[TrainingEventNote] = Field(default_factory=list, max_length=8)


class AssistantContext(_Strict):
    """1.3.0: what the screen the user is on knows. Optional; the hub's own data stays authoritative."""

    route: str | None = Field(None, max_length=120)
    training: TrainingContext | None = None


class AssistantRequest(_Strict):
    surface: Surface
    message: str = Field(min_length=1, max_length=2000)
    machine_id: str | None = None
    operator_id: str | None = None
    conversation_id: str | None = None
    context: AssistantContext | None = None  # 1.3.0


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
    synthetic: bool | None = None  # 1.3.0: true for synthetic demo knowledge (not an official publication)


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
