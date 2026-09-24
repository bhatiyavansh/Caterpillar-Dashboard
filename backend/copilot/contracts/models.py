"""Hub wire contracts.

Canonical stream payloads (`machine_state`, `worker_state`, `event`) are Person C's
`simulator.schemas` models, imported here and never redefined. This module only adds:

* the hub envelope (`seq`, `epoch`, `hub_ts`, and `rseq` on reliable messages)
* hub-only messages (hello, snapshot, heartbeat, utterance, control, control_ack, source_hello)

Every change here must be additive, bump CONTRACT_VERSION and get an entry in
docs/CONTRACT_CHANGES.md; `make contracts-check` enforces this.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from simulator.schemas import EVENT_CATALOGUE, Event, MachineState, Severity, WorkerState

CONTRACT_VERSION = "1.4.0"

#: Event kinds the hub itself (or a non-C source) may emit, on top of C's catalogue.
HUB_EVENT_KINDS: tuple[str, ...] = (
    "source_changed",  # active world source switched / lost
    "low_fuel",  # twin source only
    "engine_fault",  # twin source only
    "emergency_stop",  # twin source only
    # 1.1.0 (Phase B): confirm flow and records
    "action_pending",
    "action_confirmed",
    "action_cancelled",
    "action_failed",
    "incident_created",
    "work_order_created",
    "training_booked",
)
ALL_EVENT_KINDS: tuple[str, ...] = EVENT_CATALOGUE + HUB_EVENT_KINDS
SEVERITIES: tuple[str, ...] = ("info", "low", "medium", "high", "critical")

SourceKind = Literal["sim", "twin", "webcam", "replay", "fake"]
Provenance = Literal["live", "fake", "replay", "twin"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- envelope


class Envelope(_Strict):
    """Added by the hub to every message on /ws/live."""

    seq: int = Field(description="Hub-global; strictly increasing per connection; may skip.")
    epoch: str = Field(description="Hub run id. A change means: drop state, wait for snapshot.")
    hub_ts: str = Field(description="ISO-8601 UTC, millisecond precision, when the hub published.")


class ReliableEnvelope(Envelope):
    rseq: int = Field(description="Contiguous per epoch over reliable messages; a gap means loss.")


class LiveMachineState(MachineState, Envelope):
    """C's machine_state + envelope."""


class LiveWorkerState(WorkerState, Envelope):
    """C's worker_state + envelope."""


class RegulationRef(_Strict):
    citation: str
    quote: str = Field(description="Verbatim from the public regulation text.")


class ProtocolRef(_Strict):
    """Attached deterministically by the hub to events that have a site protocol (steps verbatim)."""

    id: str
    title: str
    severity: str
    steps: list[str]
    escalation: list[str]
    source: str
    regulation: RegulationRef | None = None


class LiveEvent(Event, ReliableEnvelope):
    """C's event + envelope + hub annotations (all optional, only present when set)."""

    source_id: str | None = Field(default=None, description="Which ingest source produced it.")
    stale: bool | None = Field(default=None, description="True when ts is >30 s older than hub receipt.")
    protocol: ProtocolRef | None = Field(default=None, description="1.2.0: matching site protocol, steps verbatim.")


# --------------------------------------------------------------------------- hub messages


class SourceInfo(_Strict):
    source_id: str
    kind: SourceKind
    provenance: Provenance
    connected: bool
    active: bool
    since: str
    last_seen: str | None = None
    messages: int = 0


class Hello(Envelope):
    type: Literal["hello"] = "hello"
    server: str = "copilot-hub"
    contract_version: str = CONTRACT_VERSION
    resumed: bool = Field(description="True when since_rseq was honoured and missed events follow.")
    sources: list[SourceInfo] = Field(default_factory=list)
    features: dict[str, str] = Field(default_factory=dict)


class Snapshot(Envelope):
    type: Literal["snapshot"] = "snapshot"
    ts: str
    rseq_at: int = Field(description="The snapshot is consistent with all reliable messages <= rseq_at.")
    machines: list[MachineState] = Field(default_factory=list)
    workers: list[WorkerState] = Field(default_factory=list)
    active_alerts: list[LiveEvent] = Field(default_factory=list)
    environment: dict[str, Any] = Field(default_factory=dict)
    sources: list[SourceInfo] = Field(default_factory=list)
    events_truncated: bool = Field(
        default=False, description="since_rseq could not be honoured; fetch GET /api/events."
    )


class Heartbeat(Envelope):
    type: Literal["heartbeat"] = "heartbeat"
    last_seq: int
    last_rseq: int
    clients: int
    sources: list[SourceInfo] = Field(default_factory=list)


class Utterance(ReliableEnvelope):
    type: Literal["utterance"] = "utterance"
    utterance_id: str
    text: str
    priority: Literal["safety", "normal", "chatter"]
    surfaces: list[str]
    machine_id: str | None = None
    reason: str
    deterministic: bool
    audio_url: str | None = None


class SourceHello(_Strict):
    """Optional first frame on /ws/ingest. C's simulator sends none (it is a `sim`)."""

    type: Literal["source_hello"] = "source_hello"
    source_id: str
    kind: SourceKind
    format: Literal["contract", "twin_snapshot"] = "contract"
    accepts_control: bool = False


class Control(_Strict):
    """Hub -> source, only to sources whose source_hello set accepts_control."""

    type: Literal["control"] = "control"
    command_id: str
    command: str
    args: dict[str, Any] = Field(default_factory=dict)
    issued_by: str = "director"


class ControlAck(_Strict):
    type: Literal["control_ack"] = "control_ack"
    command_id: str
    ok: bool
    error: str | None = None


LIVE_MESSAGES: tuple[type[BaseModel], ...] = (
    Hello,
    Snapshot,
    LiveMachineState,
    LiveWorkerState,
    LiveEvent,
    Utterance,
    Heartbeat,
)
INGEST_MESSAGES: tuple[type[BaseModel], ...] = (SourceHello, ControlAck)
CONTROL_MESSAGES: tuple[type[BaseModel], ...] = (Control,)

__all__ = [
    "CONTRACT_VERSION",
    "ALL_EVENT_KINDS",
    "HUB_EVENT_KINDS",
    "SEVERITIES",
    "Severity",
    "Envelope",
    "ReliableEnvelope",
    "LiveMachineState",
    "LiveWorkerState",
    "LiveEvent",
    "SourceInfo",
    "Hello",
    "Snapshot",
    "Heartbeat",
    "Utterance",
    "SourceHello",
    "Control",
    "ControlAck",
]
