"""SourceAdapter protocol and the lenient validation shared by contract-format sources."""

from __future__ import annotations

import itertools
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

from pydantic import ValidationError

from copilot.timeutil import now_iso_s
from simulator.schemas import Event, MachineState, WorkerState

ItemKind = Literal["machine", "worker", "event"]
ENVELOPE_KEYS = ("seq", "epoch", "hub_ts", "rseq", "source_id", "stale")


@dataclass
class Item:
    kind: ItemKind
    payload: dict[str, Any]


@dataclass
class AdapterStats:
    accepted: int = 0
    lenient: int = 0
    rejected: int = 0
    unknown_types: Counter = field(default_factory=Counter)
    last_warning: str | None = None
    warnings: Counter = field(default_factory=Counter)

    def as_dict(self) -> dict[str, Any]:
        return {
            "accepted": self.accepted,
            "lenient": self.lenient,
            "rejected": self.rejected,
            "unknown_types": dict(self.unknown_types),
            "warnings": dict(self.warnings.most_common(10)),
            "last_warning": self.last_warning,
        }


class SourceAdapter(Protocol):
    format: str
    stats: AdapterStats

    def normalize(self, raw: dict[str, Any]) -> list[Item]: ...


_STRICT = {"machine_state": MachineState, "worker_state": WorkerState, "event": Event}
_KIND: dict[str, ItemKind] = {"machine_state": "machine", "worker_state": "worker", "event": "event"}
_counter = itertools.count(1)


def _hard_ok(t: str, raw: dict[str, Any]) -> bool:
    if t == "machine_state":
        pos = raw.get("pos")
        return isinstance(raw.get("machine_id"), str) and isinstance(pos, dict) and "x" in pos and "y" in pos
    if t == "worker_state":
        return isinstance(raw.get("worker_id"), str) and isinstance(raw.get("pos"), dict)
    return isinstance(raw.get("event"), str) and isinstance(raw.get("severity"), str)


def validate_contract_frame(raw: dict[str, Any], stats: AdapterStats, id_prefix: str = "hub") -> list[Item]:
    """C's schema first; if that fails, accept when the hard-required keys exist (counted)."""
    t = raw.get("type")
    model = _STRICT.get(t) if isinstance(t, str) else None
    if model is None:
        stats.unknown_types[str(t)] += 1
        return []
    payload = {k: v for k, v in raw.items() if k not in ENVELOPE_KEYS}
    if t == "event":
        payload.setdefault("id", f"{id_prefix}_{next(_counter):06d}")
        payload.setdefault("ts", now_iso_s())
        payload.setdefault("message", payload.get("event", ""))
        payload.setdefault("data", {})
    try:
        model.model_validate(payload)
    except ValidationError as exc:
        if not _hard_ok(t, payload):
            stats.rejected += 1
            stats.last_warning = f"rejected {t}: {exc.errors()[0]['loc']} {exc.errors()[0]['msg']}"
            return []
        stats.lenient += 1
        for err in exc.errors():
            stats.warnings[f"{t}.{'.'.join(str(x) for x in err['loc'])}: {err['type']}"] += 1
        stats.last_warning = f"lenient {t}: {exc.errors()[0]['loc']} {exc.errors()[0]['msg']}"
    stats.accepted += 1
    return [Item(_KIND[t], payload)]


class ContractAdapter:
    """C's simulator (and fake_sim): frames already in the canonical format."""

    format = "contract"

    def __init__(self, id_prefix: str = "sim") -> None:
        self.stats = AdapterStats()
        self._prefix = id_prefix

    def normalize(self, raw: dict[str, Any]) -> list[Item]:
        return validate_contract_frame(raw, self.stats, self._prefix)
