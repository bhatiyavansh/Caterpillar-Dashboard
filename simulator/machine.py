"""Machine state machines.

Every machine runs one tick per simulated second.  Values are *coupled*, not
random: cycles drive task progress, work drives fuel burn and hydraulic
temperature, idling burns fuel without producing anything.
"""

from __future__ import annotations

import math
import random

from .config import (
    AMBIENT_TEMP_C,
    FleetEntry,
    MachineSpec,
    OperatorProfile,
    SKILL_CYCLE_FACTOR,
    SKILL_HARSH_PROB,
)
from .physics import (
    bubble_colour,
    excavator_reach,
    simple_margin,
    tip_over_margin,
)
from .site import (
    DUMP_AREA,
    EMPTY_ROUTE,
    LOADED_ROUTE,
    LOADER_POINT,
    STOCKPILE,
    clamp_to_site,
    road_length,
    road_point,
    to_latlon,
    zone_by_id,
    zone_of,
)

GROUND_DRAG = {"dry": 1.0, "wet": 0.92, "muddy": 0.78}


def terrain_pitch_roll(x: float, y: float) -> tuple[float, float]:
    """Gentle deterministic slope field so pitch/roll are position-consistent."""
    pitch = 2.4 * math.sin(x / 63.0) + 1.1 * math.cos(y / 41.0)
    roll = 1.8 * math.cos(x / 48.0) - 0.9 * math.sin(y / 57.0)
    return round(pitch, 2), round(roll, 2)


class Machine:
    def __init__(
        self,
        entry: FleetEntry,
        spec: MachineSpec,
        operator: OperatorProfile,
        rng: random.Random,
    ) -> None:
        self.entry = entry
        self.spec = spec
        self.operator = operator
        self.rng = rng

        self.machine_id = entry.machine_id
        self.model = spec.model
        self.machine_type = spec.machine_type
        self.operator_id = entry.operator_id

        # pose
        self.x, self.y = self._home_point()
        self.heading_deg = rng.uniform(0, 360)
        self.speed_mps = 0.0
        self.pitch_deg, self.roll_deg = terrain_pitch_roll(self.x, self.y)

        # implement angles
        self.boom_angle_deg = 35.0
        self.stick_angle_deg = -20.0
        self.swing_angle_deg = 90.0
        self.payload_kg = 0.0

        # counters
        self.engine_on = True
        self.engine_hours = round(rng.uniform(800, 3_200), 1)
        self.fuel_level_pct = rng.uniform(55.0, 95.0)
        self.fuel_used_l = 0.0
        self.load_cycles = 0
        self.idle_min = 0.0
        self.seatbelt = "fastened"
        self.hydraulic_temp_c = 58.0
        self.coolant_temp_c = 86.0
        self.fatigue_score = round(rng.uniform(0.05, 0.20), 2)
        self.fault_codes: list[str] = []
        self.harsh_swing = False

        # behaviour state
        self.status = "working"
        self.intent = "idle"
        self.phase = "dig"
        self.phase_t = 0.0
        self.target: tuple[float, float] | None = None
        self.road_t = rng.random()
        self.truck_mode = "to_loader"
        self.route: list[tuple[float, float]] = list(EMPTY_ROUTE)
        self.route_i = 0
        if self.machine_type == "truck":
            # spawned mid-route: carry on from the nearest waypoint
            self.route_i = min(
                range(len(self.route)),
                key=lambda i: math.dist((self.x, self.y), self.route[i]),
            )
        self.wait_s = 0.0
        self.dozer_dir = 1
        self.on_break = False
        self.break_s = 0.0

        # derived / injected each tick
        self.nearest_person_m = 99.0
        self.nearest_machine_m = 99.0
        self.bubble = "green"
        self.tip_over_margin = 3.0
        self.task_id: str | None = None
        self.task_progress = 0.0
        self.task_eta_min = 0.0
        self.zone = zone_of(self.x, self.y)

        # scenario overrides (None = not overridden)
        self.ov_payload_kg: float | None = None
        self.ov_boom_deg: float | None = None
        self.ov_slope_deg: float | None = None
        self.ov_hydraulic_offset_c: float = 0.0
        self.ov_fatigue: float | None = None
        self.ov_freeze_motion = False
        self.ov_scripted_motion = False

        self.cycle_factor = SKILL_CYCLE_FACTOR[operator.skill]
        self.harsh_prob = SKILL_HARSH_PROB[operator.skill]

    # -- geometry helpers --------------------------------------------------
    def _home_point(self) -> tuple[float, float]:
        role = self.entry.role
        if role == "load":
            return LOADER_POINT
        if role == "haul":
            return EMPTY_ROUTE[self.rng.randrange(len(EMPTY_ROUTE))]
        zone = zone_by_id(self.entry.home_zone if self.entry.home_zone != "road" else "A")
        return zone.random_point(self.rng)

    def _move_towards(self, tx: float, ty: float, speed: float, dt: float) -> bool:
        """Step toward a target; returns True when arrived."""
        dx, dy = tx - self.x, ty - self.y
        dist = math.hypot(dx, dy)
        if dist < 1.5:
            self.speed_mps = 0.0
            return True
        step = min(speed * dt, dist)
        self.x += dx / dist * step
        self.y += dy / dist * step
        self.x, self.y = clamp_to_site(self.x, self.y)
        self.heading_deg = round(math.degrees(math.atan2(dx, dy)) % 360.0, 1)
        self.speed_mps = round(step / dt, 2)
        return False

    @property
    def swing_radius_m(self) -> float:
        if self.machine_type != "excavator":
            return 0.0
        if self.intent not in ("swing_left", "swing_right"):
            return 0.0
        return round(excavator_reach(self.boom_angle_deg, self.stick_angle_deg, self.spec), 2)

    # -- per-type behaviour ------------------------------------------------
    def _tick_excavator(self, dt: float, world) -> float:
        """Returns units of task work completed this tick."""
        spec = self.spec
        dur = {
            "dig": 7.0, "swing_left": 4.0, "dump": 4.0, "swing_right": 4.0,
        }
        scaled = dur[self.phase] * self.cycle_factor
        self.phase_t += dt
        frac = min(self.phase_t / scaled, 1.0)
        self.speed_mps = 0.0
        work = 0.0

        if self.phase == "dig":
            self.intent = "dig"
            self.boom_angle_deg = 35.0 - 20.0 * frac
            self.stick_angle_deg = -20.0 - 15.0 * frac
            if self.ov_payload_kg is None:
                self.payload_kg = round(spec.max_payload_kg * 0.75 * frac, 0)
        elif self.phase == "swing_left":
            self.intent = "swing_left"
            self.swing_angle_deg = (90.0 - 90.0 * frac) % 360.0
            self.boom_angle_deg = 15.0 + 25.0 * frac
        elif self.phase == "dump":
            self.intent = "dump"
            if self.ov_payload_kg is None:
                self.payload_kg = round(spec.max_payload_kg * 0.75 * (1 - frac), 0)
        else:  # swing_right
            self.intent = "swing_right"
            self.swing_angle_deg = (0.0 + 90.0 * frac) % 360.0

        if frac >= 1.0:
            self.phase_t = 0.0
            order = ["dig", "swing_left", "dump", "swing_right"]
            nxt = order[(order.index(self.phase) + 1) % 4]
            self.phase = nxt
            if nxt == "dig":                       # a full cycle just finished
                self.load_cycles += 1
                work = spec.bucket_m3
                self.harsh_swing = self.rng.random() < self.harsh_prob
        self.status = "working"
        return work

    def _tick_wheel_loader(self, dt: float, world) -> float:
        speed = self.spec.max_speed_mps * 0.35
        if self.truck_mode == "to_loader":
            self.intent = "travel_forward"
            self.status = "travelling"
            if self._move_towards(*LOADER_POINT, speed, dt):
                self.truck_mode = "loading"
                self.wait_s = 0.0
        elif self.truck_mode == "loading":
            self.intent = "dump"
            self.status = "working"
            self.wait_s += dt
            self.payload_kg = max(
                0.0, self.spec.max_payload_kg * (1 - self.wait_s / 12.0)
            )
            if self.wait_s >= 12.0:
                self.load_cycles += 1
                self.truck_mode = "to_pile"
                return 1.0                          # one truck loaded
        elif self.truck_mode == "to_pile":
            self.intent = "travel_forward"
            self.status = "travelling"
            if self._move_towards(*STOCKPILE, speed, dt):
                self.truck_mode = "digging"
                self.wait_s = 0.0
        else:                                        # digging at stockpile
            self.intent = "dig"
            self.status = "working"
            self.wait_s += dt
            self.payload_kg = min(
                self.spec.max_payload_kg, self.spec.max_payload_kg * self.wait_s / 10.0
            )
            if self.wait_s >= 10.0:
                self.truck_mode = "to_loader"
        return 0.0

    def _follow_route(self, speed: float, dt: float) -> bool:
        """Drive the current haul route waypoint by waypoint.  True at the end."""
        if self.route_i >= len(self.route):
            return True
        tx, ty = self.route[self.route_i]
        if self._move_towards(tx, ty, speed, dt):
            self.route_i += 1
        return self.route_i >= len(self.route)

    def _set_route(self, route, start_at_nearest: bool = False) -> None:
        self.route = list(route)
        if start_at_nearest:
            self.route_i = min(
                range(len(self.route)),
                key=lambda i: math.dist((self.x, self.y), self.route[i]),
            )
        else:
            self.route_i = 0

    def _tick_truck(self, dt: float, world) -> float:
        drag = GROUND_DRAG.get(world.ground, 1.0)
        speed = self.spec.max_speed_mps * 0.45 * drag
        work = 0.0
        if self.truck_mode == "to_loader":
            self.intent = "travel_forward"
            self.status = "travelling"
            if self._follow_route(speed, dt):
                self.truck_mode = "queue"
                self.wait_s = 0.0
        elif self.truck_mode == "queue":
            # only one truck loads at a time; the rest idle -> loader-queue V2I
            self.status = "idle"
            self.intent = "idle"
            self.speed_mps = 0.0
            holder = world.loader_holder
            if holder is None or holder == self.machine_id:
                world.loader_holder = self.machine_id
                self.wait_s += dt
                self.status = "working"
                self.intent = "idle"
                self.payload_kg = min(
                    self.spec.max_payload_kg, self.spec.max_payload_kg * self.wait_s / 20.0
                )
                if self.wait_s >= 20.0:
                    world.loader_holder = None
                    self.truck_mode = "to_dump"
                    self._set_route(LOADED_ROUTE)
        elif self.truck_mode == "to_dump":
            self.intent = "travel_forward"
            self.status = "travelling"
            if self._follow_route(speed, dt):
                self.truck_mode = "dumping"
                self.wait_s = 0.0
        else:                                        # dumping
            self.intent = "dump"
            self.status = "working"
            self.wait_s += dt
            self.payload_kg = max(0.0, self.spec.max_payload_kg * (1 - self.wait_s / 8.0))
            if self.wait_s >= 8.0:
                self.load_cycles += 1
                work = 1.0                           # one load delivered
                self.truck_mode = "to_loader"
                self._set_route(EMPTY_ROUTE)
        return work

    def _tick_dozer(self, dt: float, world) -> float:
        zone = zone_by_id(self.entry.home_zone)
        speed = self.spec.max_speed_mps * 0.5
        work = 0.0
        if self.dozer_dir > 0:
            self.intent = "push"
            self.status = "working"
            if self._move_towards(zone.x1 - 10, self.y, speed, dt):
                self.dozer_dir = -1
                self.load_cycles += 1
                work = self.spec.bucket_m3
        else:
            self.intent = "reverse"
            self.status = "travelling"
            # reversing: heading points opposite to travel direction
            if self._move_towards(zone.x0 + 10, self.y, speed * 0.7, dt):
                self.dozer_dir = 1
            self.heading_deg = (self.heading_deg + 180.0) % 360.0
        self.payload_kg = 0.0
        return work

    def _tick_grader(self, dt: float, world) -> float:
        zone = zone_by_id("C")
        speed = self.spec.max_speed_mps * 0.25
        self.intent = "grade"
        self.status = "working"
        if self.target is None:
            self.target = (zone.x1 - 8, self.y)
        if self._move_towards(self.target[0], self.target[1], speed, dt):
            nx = zone.x0 + 8 if self.target[0] > zone.centre[0] else zone.x1 - 8
            ny = min(max(self.y + 12, zone.y0 + 8), zone.y1 - 8)
            self.target = (nx, ny)
            self.load_cycles += 1
            return self.spec.bucket_m3 * 120.0       # m2 graded per pass
        return 0.0

    # -- main tick ---------------------------------------------------------
    def tick(self, dt: float, world) -> float:
        if not self.engine_on:
            self.status = "off"
            self.intent = "idle"
            self.speed_mps = 0.0
            self._finalise(world)
            return 0.0

        work = 0.0
        if self.on_break:
            # operator out of the seat, engine running: the brief's pattern
            self.status = "idle"
            self.intent = "idle"
            self.speed_mps = 0.0
            self.seatbelt = "unfastened"
            self.break_s -= dt
            if self.break_s <= 0:
                self.on_break = False
                self.seatbelt = "fastened"
        elif self.ov_freeze_motion:
            self.status = "idle"
            self.intent = "idle"
            self.speed_mps = 0.0
        elif self.ov_scripted_motion:
            # a scenario hook is driving this machine; leave pose and intent
            # exactly as it set them and only run the coupled signals below
            pass
        else:
            handler = {
                "excavator": self._tick_excavator,
                "wheel_loader": self._tick_wheel_loader,
                "truck": self._tick_truck,
                "dozer": self._tick_dozer,
                "grader": self._tick_grader,
            }[self.machine_type]
            work = handler(dt, world)

        self._update_signals(dt, world)
        self._finalise(world)
        return work

    def _update_signals(self, dt: float, world) -> None:
        spec = self.spec
        working = self.status in ("working", "travelling")

        rate_lph = spec.working_fuel_lph if working else spec.idle_fuel_lph
        burn = rate_lph * dt / 3600.0
        self.fuel_used_l = round(self.fuel_used_l + burn, 4)
        self.fuel_level_pct = max(0.0, self.fuel_level_pct - burn / spec.tank_l * 100.0)
        self.engine_hours = round(self.engine_hours + dt / 3600.0, 4)
        if self.status == "idle":
            self.idle_min = round(self.idle_min + dt / 60.0, 3)

        load_factor = 1.0 if self.status == "working" else (0.5 if working else 0.15)
        ambient_offset = (world.temperature_c - 30.0) * 0.35
        hyd_target = 55.0 + 25.0 * load_factor + ambient_offset + self.ov_hydraulic_offset_c
        self.hydraulic_temp_c = round(
            self.hydraulic_temp_c + (hyd_target - self.hydraulic_temp_c) * 0.05 * dt, 2
        )
        cool_target = 84.0 + 6.0 * load_factor + ambient_offset * 0.4
        self.coolant_temp_c = round(
            self.coolant_temp_c + (cool_target - self.coolant_temp_c) * 0.05 * dt, 2
        )

        self.pitch_deg, self.roll_deg = terrain_pitch_roll(self.x, self.y)
        if self.ov_slope_deg is not None:
            self.pitch_deg = self.ov_slope_deg
        if self.ov_payload_kg is not None:
            self.payload_kg = self.ov_payload_kg
        if self.ov_boom_deg is not None:
            self.boom_angle_deg = self.ov_boom_deg
        if self.ov_fatigue is not None:
            self.fatigue_score = self.ov_fatigue
        else:
            hours_in = min(world.hours_on_shift / 10.0, 1.0)
            self.fatigue_score = round(min(0.95, 0.08 + 0.35 * hours_in), 2)

        # fault codes from sustained overheating
        if self.hydraulic_temp_c > 95.0 and "HYD-118" not in self.fault_codes:
            self.fault_codes.append("HYD-118")
        elif self.hydraulic_temp_c < 90.0 and "HYD-118" in self.fault_codes:
            self.fault_codes.remove("HYD-118")

    def _finalise(self, world) -> None:
        self.zone = zone_of(self.x, self.y)
        if self.machine_type == "excavator":
            self.tip_over_margin = tip_over_margin(
                self.boom_angle_deg, self.stick_angle_deg, self.swing_angle_deg,
                self.payload_kg, self.pitch_deg, self.roll_deg, self.spec,
            )
        else:
            self.tip_over_margin = simple_margin(self.pitch_deg, self.roll_deg)
        self.bubble = bubble_colour(
            self.nearest_person_m, self.nearest_machine_m,
            self.speed_mps, self.swing_radius_m,
        )

    # -- scenario hooks ----------------------------------------------------
    def clear_overrides(self) -> None:
        self.ov_payload_kg = None
        self.ov_boom_deg = None
        self.ov_slope_deg = None
        self.ov_hydraulic_offset_c = 0.0
        self.ov_fatigue = None
        self.ov_freeze_motion = False
        self.ov_scripted_motion = False
        self.on_break = False
        self.seatbelt = "fastened"
        self.fault_codes.clear()

    # -- output ------------------------------------------------------------
    def state(self, ts: str) -> dict:
        lat, lon = to_latlon(self.x, self.y)
        return {
            "type": "machine_state",
            "ts": ts,
            "machine_id": self.machine_id,
            "model": self.model,
            "machine_type": self.machine_type,
            "operator_id": self.operator_id,
            "status": self.status,
            "pos": {"x": round(self.x, 2), "y": round(self.y, 2), "lat": lat, "lon": lon},
            "heading_deg": round(self.heading_deg, 1),
            "speed_mps": round(self.speed_mps, 2),
            "intent": self.intent,
            "engine_on": bool(self.engine_on),
            "engine_hours": round(self.engine_hours, 2),
            "fuel_level_pct": round(self.fuel_level_pct, 1),
            "fuel_used_l": round(self.fuel_used_l, 2),
            "load_cycles": int(self.load_cycles),
            "idle_min": round(self.idle_min, 1),
            "seatbelt": self.seatbelt,
            "boom_angle_deg": round(self.boom_angle_deg, 1),
            "stick_angle_deg": round(self.stick_angle_deg, 1),
            "swing_angle_deg": round(self.swing_angle_deg, 1),
            "payload_kg": round(self.payload_kg, 0),
            "hydraulic_temp_c": round(self.hydraulic_temp_c, 1),
            "coolant_temp_c": round(self.coolant_temp_c, 1),
            "pitch_deg": round(self.pitch_deg, 2),
            "roll_deg": round(self.roll_deg, 2),
            "tip_over_margin": round(self.tip_over_margin, 2),
            "bubble": self.bubble,
            "nearest_person_m": round(self.nearest_person_m, 1),
            "fatigue_score": round(self.fatigue_score, 2),
            "fault_codes": list(self.fault_codes),
            "zone": self.zone,
            "task_id": self.task_id,
            "task_progress": round(self.task_progress, 3),
            "task_eta_min": round(self.task_eta_min, 1),
        }
