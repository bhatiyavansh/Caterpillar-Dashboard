"""Director scenarios: on-cue events for the live demo.

Pattern - *scripted first, real later*.  Every scenario changes the world AND
(while EMIT_SCRIPTED is on for it) emits its event directly, so the demo works
long before the real detectors exist.  As each real detector lands, flip that
scenario's flag off; the scripted path stays as the on-stage fallback.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .config import HERO_MACHINE
from .site import LOADER_POINT
from .v2x import path_of

# Flip a scenario to False once its real detector is trusted on stage.
EMIT_SCRIPTED_EVENTS: dict[str, bool] = {
    "start_shift": True,
    "rain": True,
    "unbuckle": False,        # real: safety.check_seatbelt escalates it
    "buckle": False,          # real: safety.check_seatbelt
    "worker_behind": False,   # real: safety.check_proximity sees the worker
    "fatigue": False,         # real: safety.check_fatigue reads fatigue_score
    "dozer_reversing": False,  # real: v2x.check_v2v extrapolates the paths
    "heavy_lift": False,      # real: safety.check_tip_over reads the margin
    "hydraulic_spike": True,
    "idle_anomaly": True,
    "loader_queue": True,
    "reset": False,
}


@dataclass(frozen=True)
class ScenarioInfo:
    name: str
    label: str
    description: str


SCENARIOS: tuple[ScenarioInfo, ...] = (
    ScenarioInfo("start_shift", "Start shift",
                 "Reset positions, engines on, tasks loaded and ordered."),
    ScenarioInfo("rain", "Rain moves in",
                 "Weather turns to rain, visibility drops, ground goes wet then muddy, tasks reorder."),
    ScenarioInfo("unbuckle", "Seatbelt off",
                 "EXC001 seatbelt unfastened; warning escalates chime -> voice -> travel locked."),
    ScenarioInfo("buckle", "Seatbelt on",
                 "EXC001 seatbelt refastened; alert clears."),
    ScenarioInfo("worker_behind", "Worker behind machine",
                 "A ground worker steps 3 m behind EXC001 for 10 seconds."),
    ScenarioInfo("fatigue", "Operator fatigue",
                 "EXC001 operator fatigue score rises to 0.85."),
    ScenarioInfo("dozer_reversing", "Dozer reversing",
                 "DOZ001 reverses onto a path converging with EXC001."),
    ScenarioInfo("heavy_lift", "Heavy lift on a slope",
                 "EXC001 lifts 3,200 kg with the boom low on an 8 degree slope."),
    ScenarioInfo("hydraulic_spike", "Hydraulic temperature spike",
                 "EXC001 hydraulic temperature climbs 25 C over 20 seconds."),
    ScenarioInfo("idle_anomaly", "Excessive idling",
                 "EXC002 has idled 50 minutes with almost no load cycles."),
    ScenarioInfo("loader_queue", "Loader queue backs up",
                 "Three trucks queue at the loader point."),
    ScenarioInfo("reset", "Reset",
                 "Clear every override and return the site to normal."),
)


class ScenarioEngine:
    def __init__(self, world) -> None:
        self.world = world
        world.scenario_hooks = []

    # -- plumbing ----------------------------------------------------------
    def _bus(self):
        return self.world.bus

    def _emit(self, scenario: str, *args, **kwargs) -> list[dict]:
        """Emit a scripted event unless this scenario's real detector is live."""
        if not EMIT_SCRIPTED_EVENTS.get(scenario, True):
            return []
        kwargs.setdefault("sim_time_s", self.world.sim_time_s)
        kwargs.setdefault("force", True)
        kwargs.setdefault("source", "scenario")
        evt = self._bus().emit(*args, **kwargs)
        return [evt] if evt else []

    def trigger(self, name: str, **params) -> dict:
        handler = getattr(self, f"_s_{name}", None)
        if handler is None:
            return {"ok": False, "scenario": name, "error": "unknown scenario",
                    "events_emitted": []}
        events = handler(**params) or []
        if name != "reset":
            self.world.active_scenarios[name] = dict(params)
        return {
            "ok": True,
            "scenario": name,
            "events_emitted": [e["id"] for e in events],
            "events": events,
        }

    # -- scenarios ---------------------------------------------------------
    def _s_start_shift(self, **_) -> list[dict]:
        w = self.world
        for m in w.machines:
            m.clear_overrides()
            m.engine_on = True
            m.fuel_used_l = 0.0
            m.idle_min = 0.0
            m.load_cycles = 0
        events: list[dict] = []
        for operator_id in w.tasks.by_operator:
            payload = w.tasks.reorder(operator_id, "shift start - default order")
            events += self._emit(
                "start_shift", "task_reordered", "info",
                f"Shift plan issued for {operator_id}",
                None, data=payload,
            )
        return events

    def _s_rain(self, **_) -> list[dict]:
        w = self.world
        w.weather = "rain"
        w.visibility_m = 300.0
        w.ground = "wet"
        w.wet_since_s = w.sim_time_s          # world turns it muddy after 60 s

        events = self._emit(
            "rain", "weather_change", "medium",
            "Rain moving in - visibility 300 m, ground turning wet",
            None, data={"weather": "rain", "visibility_m": 300, "ground": "wet"},
        )

        from intelligence.risk import get_working_risk
        risk = get_working_risk(
            weather="rain", temperature_c=w.temperature_c, visibility_m=300.0,
            ground="wet", hours_on_shift=w.hours_on_shift,
        )
        events += self._emit(
            "rain", "working_risk_changed", "medium",
            f"Working conditions now {risk['level']} risk",
            None, data=risk,
        )
        for operator_id in w.tasks.by_operator:
            payload = w.tasks.reorder(operator_id, "rain - reschedule rain-sensitive work")
            events += self._emit(
                "rain", "task_reordered", "info",
                f"Tasks resequenced for {operator_id} because of rain",
                None, data=payload,
            )
        return events

    def _s_unbuckle(self, machine_id: str = HERO_MACHINE, **_) -> list[dict]:
        m = self.world.by_id[machine_id]
        m.seatbelt = "unfastened"
        m.on_break = False
        return self._emit(
            "unbuckle", "seatbelt_unfastened", "high",
            f"Seatbelt unfastened - warning chime ({machine_id})",
            machine_id, data={"escalation_level": 1},
        )

    def _s_buckle(self, machine_id: str = HERO_MACHINE, **_) -> list[dict]:
        m = self.world.by_id[machine_id]
        m.seatbelt = "fastened"
        m.on_break = False
        self.world.active_scenarios.pop("unbuckle", None)
        return self._emit(
            "buckle", "seatbelt_fastened", "info",
            f"Seatbelt refastened on {machine_id}",
            machine_id, data={},
        )

    def _s_worker_behind(
        self, machine_id: str = HERO_MACHINE, distance_m: float = 3.0,
        duration_s: float = 10.0, **_,
    ) -> list[dict]:
        w = self.world
        m = w.by_id[machine_id]
        worker = min(w.workers, key=lambda k: math.dist((k.x, k.y), (m.x, m.y)))
        rad = math.radians((m.heading_deg + 180.0) % 360.0)
        worker.pin_to(
            m.x + math.sin(rad) * distance_m,
            m.y + math.cos(rad) * distance_m,
            w.sim_time_s + duration_s,
        )
        return self._emit(
            "worker_behind", "proximity_alert", "critical",
            f"Person detected {distance_m:.1f} m behind {machine_id}",
            machine_id,
            data={"distance_m": distance_m, "zone": "rear", "worker_id": worker.worker_id},
        )

    def _s_fatigue(self, machine_id: str = HERO_MACHINE, score: float = 0.85, **_) -> list[dict]:
        m = self.world.by_id[machine_id]
        m.ov_fatigue = score
        return self._emit(
            "fatigue", "fatigue_alert", "high",
            f"Operator fatigue detected on {machine_id} - take a break",
            machine_id,
            data={"eyes_closed_s": round(score * 4, 1), "fatigue_score": score},
        )

    def _s_dozer_reversing(
        self, dozer_id: str = "DOZ001", target_id: str = HERO_MACHINE, **_,
    ) -> list[dict]:
        w = self.world
        dozer, target = w.by_id[dozer_id], w.by_id[target_id]

        # place the dozer just outside V2V range and reverse it straight at the
        # excavator, so the real detector picks the conflict up within seconds
        start_gap = 22.0
        bearing = math.atan2(dozer.x - target.x, dozer.y - target.y)
        dozer.x = target.x + math.sin(bearing) * start_gap
        dozer.y = target.y + math.cos(bearing) * start_gap
        dozer.ov_scripted_motion = True
        dozer.intent = "reverse"
        dozer.status = "travelling"
        dozer.speed_mps = dozer.spec.max_speed_mps * 0.5
        # reversing: the machine points away from where it is going
        dozer.heading_deg = (math.degrees(bearing) + 0.0) % 360.0
        dozer.ov_freeze_motion = False

        ttc = start_gap / max(dozer.speed_mps, 0.1)

        def hold(world) -> bool:
            """Keep the dozer reversing at the target until they nearly meet."""
            d = math.dist((dozer.x, dozer.y), (target.x, target.y))
            if d < 8.0:
                dozer.speed_mps = 0.0
                dozer.ov_scripted_motion = False
                return False
            rad = math.radians((dozer.heading_deg + 180.0) % 360.0)
            dozer.x += math.sin(rad) * dozer.speed_mps
            dozer.y += math.cos(rad) * dozer.speed_mps
            dozer.intent = "reverse"
            dozer.status = "travelling"
            return True

        w.scenario_hooks.append(hold)

        return self._emit(
            "dozer_reversing", "v2v_collision_risk", "high",
            f"{dozer_id} reversing toward {target_id} - {ttc:.1f} s to conflict",
            dozer_id,
            data={
                "machine_a": dozer_id, "machine_b": target_id,
                "time_to_conflict_s": round(ttc, 1), "min_distance_m": 0.0,
                "path_a": path_of(dozer), "path_b": path_of(target),
            },
        )

    def _s_heavy_lift(
        self, machine_id: str = HERO_MACHINE, payload_kg: float = 3_200.0,
        slope_deg: float = 8.0, **_,
    ) -> list[dict]:
        m = self.world.by_id[machine_id]
        m.ov_payload_kg = payload_kg
        m.ov_boom_deg = 15.0
        m.ov_slope_deg = slope_deg
        m.stick_angle_deg = -10.0
        m.swing_angle_deg = 90.0          # over the side: the weak axis
        # hold the load out at reach instead of carrying on with the dig cycle,
        # which would swing the boom back in and recover the margin next tick
        m.ov_scripted_motion = True
        m.status = "working"
        m.intent = "swing_left"
        m.speed_mps = 0.0
        m._finalise(self.world)
        return self._emit(
            "heavy_lift", "tip_over_warning", "critical",
            f"Tip-over risk on {machine_id} - margin {m.tip_over_margin:.2f}",
            machine_id,
            data={"margin": m.tip_over_margin, "payload_kg": payload_kg,
                  "slope_deg": slope_deg},
        )

    def _s_hydraulic_spike(
        self, machine_id: str = HERO_MACHINE, delta_c: float = 25.0,
        ramp_s: float = 20.0, **_,
    ) -> list[dict]:
        m = self.world.by_id[machine_id]
        start = self.world.sim_time_s

        def ramp(world) -> bool:
            elapsed = world.sim_time_s - start
            m.ov_hydraulic_offset_c = delta_c * min(elapsed / ramp_s, 1.0)
            return elapsed < ramp_s

        self.world.scenario_hooks.append(ramp)
        return self._emit(
            "hydraulic_spike", "maintenance_due", "medium",
            f"Hydraulic temperature climbing on {machine_id} - service pump soon",
            machine_id,
            data={"component": "hydraulic_pump", "health_pct": 58, "hours_to_service": 120},
        )

    def _s_idle_anomaly(
        self, machine_id: str = "EXC002", idle_min: float = 50.0, **_,
    ) -> list[dict]:
        m = self.world.by_id[machine_id]
        m.idle_min = idle_min
        m.load_cycles = max(0, m.load_cycles)
        m.on_break = True
        m.break_s = 600.0
        m.seatbelt = "unfastened"
        wasted_l = round(m.spec.idle_fuel_lph * idle_min / 60.0, 1)
        from .config import DIESEL_PRICE_INR
        return self._emit(
            "idle_anomaly", "anomaly_detected", "medium",
            f"Excessive idling on {machine_id} - {idle_min:.0f} min idle, almost no cycles",
            machine_id,
            data={
                "anomaly_type": "excessive_idling", "score": 0.91,
                "fuel_cost_inr": round(wasted_l * DIESEL_PRICE_INR),
                "window_min": 120,
            },
        )

    def _s_loader_queue(self, count: int = 3, **_) -> list[dict]:
        w = self.world
        trucks = [m for m in w.machines if m.machine_type == "truck"][:count]
        for i, t in enumerate(trucks):
            t.truck_mode = "queue"
            t.wait_s = 0.0
            t.x = LOADER_POINT[0] - 12.0 * (i + 1)
            t.y = LOADER_POINT[1] - 6.0 * (i + 1)
            t.speed_mps = 0.0
            t.status = "idle"
            t.intent = "idle"
        w.loader_holder = trucks[0].machine_id if trucks else None
        suggestion = f"Loader queue is {count} deep - hold at dump area"
        return self._emit(
            "loader_queue", "v2i_suggestion", "info", suggestion,
            trucks[-1].machine_id if trucks else None,
            data={"node_id": "N-LOADQ", "node_type": "loader_queue",
                  "suggestion": suggestion, "queue_depth": count},
        )

    def _s_reset(self, **_) -> list[dict]:
        w = self.world
        w.scenario_hooks.clear()
        w.active_scenarios.clear()
        for m in w.machines:
            m.clear_overrides()
        w.weather = "clear"
        w.ground = "dry"
        w.visibility_m = 10_000.0
        w.wet_since_s = None
        w.gate_occupied = False
        w.bus.reset_debounce()
        for state in w._belt_state.values():
            state.clear()
        return []
