"""Shift task generation, progress tracking, ETA and rain-driven reordering."""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

from .config import (
    BASE_RATE,
    DEFAULT_BASE_RATE,
    FLEET,
    SHIFT_START_HOUR,
    SKILL_FACTOR,
    SOIL_FACTOR,
)

ROLE_TASK_TYPE = {
    "trench": "trenching",
    "excavate": "trenching",
    "load": "loading",
    "push": "dozing",
    "haul": "hauling",
    "grade": "grading",
}

# tasks whose quality suffers most in rain -> pushed later in the shift
RAIN_SENSITIVE = {"trenching", "grading"}

SOILS = ("sand", "mixed", "clay", "rock")


def base_rate(task_type: str, model: str) -> float:
    return BASE_RATE.get((task_type, model), DEFAULT_BASE_RATE)


def nominal_volume(task_type: str, rng: random.Random) -> float:
    if task_type == "trenching":
        return round(rng.uniform(60, 200), 1)
    if task_type == "loading":
        return float(rng.randint(10, 20))          # trucks
    if task_type == "grading":
        return round(rng.uniform(2_000, 6_000), 0)  # m2
    if task_type == "dozing":
        return round(rng.uniform(150, 400), 1)     # m3
    return float(rng.randint(8, 16))               # hauling: loads


def planner_estimate_min(task_type: str, model: str, volume: float) -> float:
    """Naive planner number - what the site office would have written down."""
    return round(volume / base_rate(task_type, model) * 60.0, 1)


class ShiftTask:
    """Mutable runtime task; `to_dict()` matches contract 5.3 exactly."""

    def __init__(
        self,
        task_id: str,
        operator_id: str,
        machine_id: str,
        task_type: str,
        zone: str,
        volume_m3: float,
        soil: str,
        order: int,
        planned_start: datetime,
        estimate_p50: float,
    ) -> None:
        self.task_id = task_id
        self.operator_id = operator_id
        self.machine_id = machine_id
        self.task_type = task_type
        self.zone = zone
        self.volume_m3 = volume_m3
        self.soil = soil
        self.order = order
        self.planned_start = planned_start
        self.progress = 0.0
        self.status = "pending"
        self.done_units = 0.0
        self.estimate_p50 = estimate_p50
        self.eta_min = estimate_p50

    def advance(self, units: float) -> None:
        if self.status == "done":
            return
        self.status = "in_progress"
        self.done_units = min(self.done_units + units, self.volume_m3)
        self.progress = round(self.done_units / self.volume_m3, 4) if self.volume_m3 else 1.0
        if self.progress >= 1.0:
            self.progress = 1.0
            self.status = "done"
            self.eta_min = 0.0

    def linear_eta_min(self, units_per_min: float) -> float:
        if self.status == "done":
            return 0.0
        remaining = max(self.volume_m3 - self.done_units, 0.0)
        if units_per_min <= 1e-6:
            return round(self.estimate_p50 * (1 - self.progress), 1)
        return round(remaining / units_per_min, 1)

    def to_dict(self) -> dict:
        p50 = self.estimate_p50
        return {
            "task_id": self.task_id,
            "operator_id": self.operator_id,
            "machine_id": self.machine_id,
            "task_type": self.task_type,
            "zone": self.zone,
            "volume_m3": float(self.volume_m3),
            "soil": self.soil,
            "status": self.status,
            "order": self.order,
            "progress": float(self.progress),
            "planned_start": self.planned_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "eta_min": float(round(self.eta_min, 1)),
            "estimate": {
                "p10": float(round(p50 * 0.85, 1)),
                "p50": float(round(p50, 1)),
                "p90": float(round(p50 * 1.25, 1)),
            },
        }


class TaskBoard:
    """All shift tasks, indexed by operator."""

    def __init__(self, rng: random.Random, day: datetime | None = None) -> None:
        self.rng = rng
        self.day = day or datetime.now(timezone.utc).replace(
            hour=SHIFT_START_HOUR, minute=0, second=0, microsecond=0
        )
        self.by_operator: dict[str, list[ShiftTask]] = {}
        self.by_id: dict[str, ShiftTask] = {}
        self._generate()

    def _generate(self) -> None:
        counter = 1
        for entry in FLEET:
            task_type = ROLE_TASK_TYPE[entry.role]
            zone = entry.home_zone if entry.home_zone != "road" else "road"
            tasks: list[ShiftTask] = []
            for order in range(1, 4):
                volume = nominal_volume(task_type, self.rng)
                soil = self.rng.choice(SOILS)
                est = planner_estimate_min(task_type, entry.model, volume)
                # ground truth modifiers the planner did not know about
                est *= SOIL_FACTOR[soil]
                task = ShiftTask(
                    task_id=f"T-{counter:04d}",
                    operator_id=entry.operator_id,
                    machine_id=entry.machine_id,
                    task_type=task_type,
                    zone=zone,
                    volume_m3=volume,
                    soil=soil,
                    order=order,
                    planned_start=self.day + timedelta(minutes=(order - 1) * 180),
                    estimate_p50=round(est, 1),
                )
                tasks.append(task)
                self.by_id[task.task_id] = task
                counter += 1
            self.by_operator[entry.operator_id] = tasks

    # -- queries -----------------------------------------------------------
    def active(self, operator_id: str) -> ShiftTask | None:
        """First task that is not finished, in current order."""
        for t in sorted(self.by_operator.get(operator_id, []), key=lambda t: t.order):
            if t.status != "done":
                return t
        return None

    def for_operator(self, operator_id: str) -> list[dict]:
        return [
            t.to_dict()
            for t in sorted(self.by_operator.get(operator_id, []), key=lambda t: t.order)
        ]

    def all_tasks(self) -> list[dict]:
        return [t.to_dict() for t in self.by_id.values()]

    # -- mutation ----------------------------------------------------------
    def reorder(self, operator_id: str, reason: str) -> dict:
        """Rain rule: move rain-sensitive tasks to the back of the queue.

        Returns the payload for a `task_reordered` event.
        """
        tasks = sorted(self.by_operator.get(operator_id, []), key=lambda t: t.order)
        old_order = [t.task_id for t in tasks]
        if not tasks:
            return {"operator_id": operator_id, "old_order": [], "new_order": [], "reason": reason}

        rainy = "rain" in reason.lower() or "wet" in reason.lower()
        if rainy:
            pending = [t for t in tasks if t.status != "in_progress"]
            running = [t for t in tasks if t.status == "in_progress"]
            pending.sort(key=lambda t: (t.task_type in RAIN_SENSITIVE, t.order))
            new_list = running + pending
        else:
            new_list = tasks

        for i, t in enumerate(new_list, start=1):
            t.order = i

        return {
            "operator_id": operator_id,
            "old_order": old_order,
            "new_order": [t.task_id for t in new_list],
            "reason": reason,
        }
