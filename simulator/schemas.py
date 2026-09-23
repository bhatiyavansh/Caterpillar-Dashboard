"""Pydantic v2 contracts for every message the simulator emits.

THESE SHAPES ARE SHARED WITH PERSON A (3D twin), PERSON B (backend/agent) and
PERSON D (screens).  Do not rename or remove a field without telling the team.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

MachineType = Literal["excavator", "wheel_loader", "dozer", "truck", "grader"]
Status = Literal["working", "idle", "travelling", "off"]
Intent = Literal[
    "dig", "swing_left", "swing_right", "dump",
    "travel_forward", "reverse", "idle", "push", "grade",
]
Seatbelt = Literal["fastened", "unfastened"]
Bubble = Literal["green", "amber", "red"]
Severity = Literal["info", "low", "medium", "high", "critical"]
Source = Literal["simulator", "scenario", "webcam", "rules", "ml", "v2v", "v2i"]
TaskType = Literal["trenching", "loading", "grading", "dozing", "hauling"]
TaskStatus = Literal["pending", "in_progress", "done"]


class Pos(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float
    y: float
    lat: float
    lon: float


class MachineState(BaseModel):
    """One per machine per second.  Contract section 5.1."""

    model_config = ConfigDict(extra="forbid", protected_namespaces=())

    type: Literal["machine_state"] = "machine_state"
    ts: str
    machine_id: str
    model: str
    machine_type: MachineType
    operator_id: str
    status: Status
    pos: Pos
    heading_deg: float
    speed_mps: float
    intent: Intent
    engine_on: bool
    engine_hours: float
    fuel_level_pct: float
    fuel_used_l: float
    load_cycles: int
    idle_min: float
    seatbelt: Seatbelt
    boom_angle_deg: float
    stick_angle_deg: float
    swing_angle_deg: float
    payload_kg: float
    hydraulic_temp_c: float
    coolant_temp_c: float
    pitch_deg: float
    roll_deg: float
    tip_over_margin: float
    bubble: Bubble
    nearest_person_m: float
    fatigue_score: float
    fault_codes: list[str] = Field(default_factory=list)
    zone: str
    task_id: str | None = None
    task_progress: float = 0.0
    task_eta_min: float = 0.0


class WorkerState(BaseModel):
    """One per ground worker per second.  Contract section 7.4."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["worker_state"] = "worker_state"
    ts: str
    worker_id: str
    pos: Pos
    zone: str


class Event(BaseModel):
    """Safety / anomaly / advisory event.  Contract section 5.2."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["event"] = "event"
    id: str
    ts: str
    event: str
    severity: Severity
    machine_id: str | None = None
    source: Source
    message: str
    data: dict[str, Any] = Field(default_factory=dict)


class Estimate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    p10: float
    p50: float
    p90: float


class Task(BaseModel):
    """Contract section 5.3."""

    model_config = ConfigDict(extra="forbid")

    task_id: str
    operator_id: str
    machine_id: str
    task_type: TaskType
    zone: str
    volume_m3: float
    soil: str
    status: TaskStatus
    order: int
    progress: float
    planned_start: str
    eta_min: float
    estimate: Estimate


EVENT_CATALOGUE: tuple[str, ...] = (
    "seatbelt_unfastened",
    "seatbelt_fastened",
    "proximity_alert",
    "fatigue_alert",
    "tip_over_warning",
    "v2v_collision_risk",
    "v2i_suggestion",
    "anomaly_detected",
    "maintenance_due",
    "weather_change",
    "task_reordered",
    "working_risk_changed",
)
