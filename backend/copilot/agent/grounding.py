"""Grounding check (P2_SPEC §5.6): every number and ID in an answer must come from this turn's data.

Sources = tool results + live context + citations + the user's own message. A stated number v
(written with d decimals) is grounded when some source variant s rounds to it at d decimals, or,
for a whole number and |s| >= 100, is within 0.5 %. Variants of a source number: s, s*100 (fractions shown as %),
s/60 and s%60 (minutes shown as hours + minutes). Small integers 0-10 are always allowed (counts,
ordinals, "2 minutes" phrasing) - a documented trade-off.

On the training surface an answer must also not claim a lesson step passed unless the telemetry
validator's phase says so (`training_claims`).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

ID_RE = re.compile(r"\b(?:[A-Z]{3}\d{3}|OP\d{4}|T-\d{4}|INC-[\d-]+|WO-[\d-]+|BK-[\d-]+|W0\d|[A-Z]{3}-\d{3}|evt_\d+)\b")
NUM_RE = re.compile(r"(?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])-?\d+(?:\.\d+)?")


@dataclass
class GroundingReport:
    grounded: bool
    ungrounded_numbers: list[str] = field(default_factory=list)
    ungrounded_ids: list[str] = field(default_factory=list)
    uncertified_claims: list[str] = field(default_factory=list)

    @property
    def problems(self) -> list[str]:
        return self.ungrounded_numbers + self.ungrounded_ids + self.uncertified_claims


def _walk_numbers(obj: Any, out: set[float]) -> None:
    if isinstance(obj, bool):
        return
    if isinstance(obj, int | float):
        out.add(float(obj))
    elif isinstance(obj, dict):
        for v in obj.values():
            _walk_numbers(v, out)
    elif isinstance(obj, list | tuple):
        for v in obj:
            _walk_numbers(v, out)
    elif isinstance(obj, str):
        for m in NUM_RE.findall(obj):
            try:
                out.add(float(m.replace(",", "")))
            except ValueError:
                pass


def _strip_ids(text: str) -> str:
    return ID_RE.sub(" ", text)


#: A training answer must not certify a lesson step: only the telemetry validator does that.
PASS_CLAIM_RE = re.compile(
    r"\b(?:you(?:'ve| have)?|you've) (?:just )?(?:passed|completed|finished|cleared|nailed|done) "
    r"(?:it|this|that|the|this step|that step|the step|the lesson|the level)\b"
    r"|\b(?:step|lesson|level) (?:is |has been )?(?:passed|complete[d]?|done)\b", re.IGNORECASE)
CERTIFIED_PHASES = {"passed", "levelDone", "finished"}


def training_claims(answer: str, training: dict[str, Any] | None) -> list[str]:
    """Pass/complete claims the validator has not made. Empty when there is no lesson context."""
    if not training or training.get("phase") in CERTIFIED_PHASES:
        return []
    return [f"claims the step passed ({m.group(0)!r}) but the sensors say phase={training.get('phase') or 'none'}"
            for m in PASS_CLAIM_RE.finditer(answer)]


def check(answer: str, sources: list[Any], user_message: str = "",
          training: dict[str, Any] | None = None) -> GroundingReport:
    blob = json.dumps(sources, default=str) + " " + user_message
    source_ids = set(ID_RE.findall(blob))
    nums: set[float] = set()
    _walk_numbers(sources, nums)
    _walk_numbers(user_message, nums)
    allowed: list[float] = []
    for s in nums:
        allowed += [s, s * 100, s / 60, s % 60, round(s / 60, 1)]

    bad_ids = sorted({i for i in ID_RE.findall(answer) if i not in source_ids})
    bad_nums: list[str] = []
    for raw in NUM_RE.findall(_strip_ids(answer)):
        clean = raw.replace(",", "")
        v = float(clean)
        if v.is_integer() and 0 <= v <= 10 and "." not in clean:
            continue
        d = len(clean.split(".")[1]) if "." in clean else 0
        if not any(round(s, d) == v or (d == 0 and abs(s) >= 100 and abs(v - s) <= abs(s) * 0.005) for s in allowed):
            bad_nums.append(raw)
    claims = training_claims(answer, training)
    return GroundingReport(not bad_ids and not bad_nums and not claims, sorted(set(bad_nums)), bad_ids, claims)
