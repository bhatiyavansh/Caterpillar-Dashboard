"""The world: owns every machine, worker and task, and steps them once a second."""

from __future__ import annotations

import math
import random
from collections import deque
from datetime import datetime, timezone

from .config import (
    AMBIENT_TEMP_C,
    FLEET,
    HERO_MACHINE,
    OPERATORS,
    SEED,
    SKILL_FACTOR,
    SOIL_FACTOR,
    SPECS,
    WEATHER_FACTOR,
)
from .machine import Machine
from .safety import EventBus, run_all, utc_now_iso
from .site import SITE_LAYOUT
from .tasks import TaskBoard, base_rate
from .v2x import check_v2i, check_v2v
from .worker import build_workers

ANOMALY_WINDOW_S = 60
# roughly two unscheduled breaks per operator per 10-hour shift
BREAK_PROB_PER_TICK = 2 / (10 * 3600)
BREAK_MIN_S, BREAK_MAX_S = 180, 480
_OPERATOR_BY_ID = {o.operator_id: o for o in OPERATORS}


class World:
    def __init__(self, seed: int = SEED) -> None:
        self.rng = random.Random(seed)
        self.seed = seed
        self.tick_no = 0
        self.sim_time_s = 0.0
        self.started_at = datetime.now(timezone.utc)

        self.machines: list[Machine] = [
            Machine(entry, SPECS[entry.model], _OPERATOR_BY_ID[entry.operator_id], self.rng)
            for entry in FLEET
        ]
        self.by_id: dict[str, Machine] = {m.machine_id: m for m in self.machines}
        self.workers = build_workers(self.rng)
        self.tasks = TaskBoard(self.rng)

        # environment
        self.weather = "clear"
        self.ground = "dry"
        self.visibility_m = 10_000.0
        self.temperature_c = AMBIENT_TEMP_C
        self.wet_since_s: float | None = None

        # shared resources
        self.loader_holder: str | None = None
        self.gate_occupied = False

        self.bus = EventBus()
        self._belt_state: dict[str, dict] = {m.machine_id: {} for m in self.machines}
        self._v2v_last: dict[tuple[str, str], float] = {}
        self._windows: dict[str, deque] = {
            m.machine_id: deque(maxlen=ANOMALY_WINDOW_S) for m in self.machines
        }

        # scenario engine attaches itself here (set by scenarios.ScenarioEngine)
        self.scenario_hooks: list = []
        self.active_scenarios: dict[str, dict] = {}

        self.last_states: dict[str, dict] = {}
        self.last_worker_states: dict[str, dict] = {}
        self._seed_initial_tasks()

    # -- helpers -----------------------------------------------------------
    @property
    def hours_on_shift(self) -> float:
        return self.sim_time_s / 3600.0

    def _seed_initial_tasks(self) -> None:
        for m in self.machines:
            task = self.tasks.active(m.operator_id)
            if task:
                m.task_id = task.task_id
                m.task_progress = task.progress
                m.task_eta_min = task.eta_min

    def _units_per_min(self, machine, task=None) -> float:
        """Production rate in task units per minute.

        Deliberately the same formula as the ground truth in the historical data
        generator, so `task_eta_min` and `task_progress` can never disagree: the
        planner rate, slowed by weather, soil and operator skill.
        """
        task = task or (self.tasks.by_id.get(machine.task_id) if machine.task_id else None)
        if task is None:
            return 0.0
        rate = base_rate(task.task_type, machine.model) / 60.0
        drag = (
            SKILL_FACTOR[machine.operator.skill]
            * WEATHER_FACTOR.get(self.weather, 1.0)
            * SOIL_FACTOR.get(task.soil, 1.0)
        )
        return rate / drag if drag else rate

    # -- the tick ----------------------------------------------------------
    def tick(self, dt: float = 1.0) -> list[dict]:
        self.tick_no += 1
        self.sim_time_s += dt
        ts = utc_now_iso()

        self._run_scenario_hooks()
        self._update_ground(dt)

        for w in self.workers:
            w.tick(self.tick_no, dt, self.machines)

        for m in self.machines:
            self._maybe_break(m)
            m.tick(dt, self)
            self._apply_work(m, dt)

        self._update_proximity()

        for m in self.machines:
            run_all(m, self.workers, self.bus, self.sim_time_s, self._belt_state[m.machine_id])

        check_v2v(self.machines, self.bus, self.sim_time_s, self._v2v_last)
        check_v2i(self.machines, self.bus, self.sim_time_s, self)
        self._score_anomalies()

        messages: list[dict] = []
        for m in self.machines:
            st = m.state(ts)
            self.last_states[m.machine_id] = st
            self._windows[m.machine_id].append(st)
            messages.append(st)
        for w in self.workers:
            st = w.state(ts)
            self.last_worker_states[w.worker_id] = st
            messages.append(st)
        messages.extend(self.bus.drain())
        return messages

    def _apply_work(self, machine, dt: float) -> None:
        """Advance the active task at the machine's production rate.

        Progress accrues only while the machine is actually working - idling or
        travelling burns fuel and clock without moving the task forward, which
        is what makes the idle-anomaly story land.
        """
        task = self.tasks.active(machine.operator_id)
        if task is None:
            machine.task_id = None
            machine.task_progress = 1.0
            machine.task_eta_min = 0.0
            return

        rate = self._units_per_min(machine, task)
        if machine.status == "working" and machine.engine_on:
            task.advance(rate * dt / 60.0)

        machine.task_id = task.task_id
        machine.task_progress = task.progress
        task.eta_min = task.linear_eta_min(rate)
        machine.task_eta_min = task.eta_min

    def _maybe_break(self, machine) -> None:
        """Operators occasionally leave the seat with the engine running.

        This is the pattern the brief's sample data shows - unfastened seatbelt
        alongside high idle and near-zero load cycles - so the live stream
        reproduces it, not just the historical data.  The hero machine is left
        alone; its seatbelt is the director's to control.
        """
        if machine.machine_id == HERO_MACHINE or machine.on_break:
            return
        if self.rng.random() < BREAK_PROB_PER_TICK:
            machine.on_break = True
            machine.break_s = self.rng.uniform(BREAK_MIN_S, BREAK_MAX_S)

    def _update_proximity(self) -> None:
        for m in self.machines:
            nearest_p = 99.0
            for w in self.workers:
                d = math.dist((m.x, m.y), (w.x, w.y))
                if d < nearest_p:
                    nearest_p = d
            nearest_m = 99.0
            for o in self.machines:
                if o is m:
                    continue
                d = math.dist((m.x, m.y), (o.x, o.y))
                if d < nearest_m:
                    nearest_m = d
            m.nearest_person_m = round(nearest_p, 1)
            m.nearest_machine_m = round(nearest_m, 1)
            m._finalise(self)

    def _update_ground(self, dt: float) -> None:
        """Rain turns the ground wet, then muddy after 60 s."""
        if self.weather != "rain":
            return
        if self.wet_since_s is None:
            self.wet_since_s = self.sim_time_s
            self.ground = "wet"
        elif self.sim_time_s - self.wet_since_s >= 60 and self.ground != "muddy":
            self.ground = "muddy"

    def _run_scenario_hooks(self) -> None:
        for hook in list(self.scenario_hooks):
            if hook(self) is False:
                self.scenario_hooks.remove(hook)

    def _score_anomalies(self) -> None:
        if self.tick_no % ANOMALY_WINDOW_S != 0:
            return
        try:
            from intelligence.anomaly import score_live_window
        except Exception:
            return
        for mid, window in self._windows.items():
            if len(window) < ANOMALY_WINDOW_S:
                continue
            try:
                result = score_live_window(list(window))
            except Exception:
                continue
            if not result:
                continue
            self.bus.emit(
                "anomaly_detected", "medium",
                f"{result.get('type', 'anomaly')} detected on {mid}",
                mid, "ml",
                {
                    "anomaly_type": result.get("type"),
                    "score": result.get("score"),
                    "fuel_cost_inr": result.get("fuel_cost_inr", 0),
                    "window_min": ANOMALY_WINDOW_S // 60 or 1,
                },
                self.sim_time_s,
            )

    # -- introspection -----------------------------------------------------
    def snapshot(self) -> dict:
        return {
            "ts": utc_now_iso(),
            "tick": self.tick_no,
            "sim_time_s": round(self.sim_time_s, 1),
            "seed": self.seed,
            "environment": {
                "weather": self.weather,
                "ground": self.ground,
                "visibility_m": self.visibility_m,
                "temperature_c": self.temperature_c,
                "hours_on_shift": round(self.hours_on_shift, 2),
            },
            "machines": list(self.last_states.values()),
            "workers": list(self.last_worker_states.values()),
            "tasks": self.tasks.all_tasks(),
            "recent_events": self.bus.history[-30:],
            "active_scenarios": list(self.active_scenarios.keys()),
            "site_layout": SITE_LAYOUT,
        }

    def reset(self) -> None:
        fresh = World(seed=self.seed)
        self.__dict__.update(
            {k: v for k, v in fresh.__dict__.items() if k != "scenario_hooks"}
        )
        self.scenario_hooks = []
        self.active_scenarios = {}
