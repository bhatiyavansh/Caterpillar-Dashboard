"""V2V collision prediction and V2I node advisories."""

from __future__ import annotations

import math

from .config import V2V_DEBOUNCE_S, V2V_HORIZON_S, V2V_SCAN_RADIUS_M
from .safety import EventBus
from .site import DUMP_AREA, LOADER_POINT, STOCKPILE, V2I_NODES

STEP_S = 0.5
FUEL_LOW_PCT = 25.0
QUEUE_DEEP = 3
# advisories describe a standing condition, not a moment - re-advise rarely
ADVISORY_DEBOUNCE_S = 900.0

# Machines meeting at a service point are queuing, not colliding - that is the
# V2I layer's job.  Conflicts predicted inside these circles are suppressed.
SERVICE_POINTS: tuple[tuple[float, float], ...] = (
    LOADER_POINT, DUMP_AREA, STOCKPILE,
    tuple(n for n in ()) or (200.0, 30.0),   # fuel bay
)
SERVICE_RADIUS_M = 25.0
REACTION_S = 0.5        # closing distance a machine covers before reacting
# two machines travelling within this many degrees of each other are following
# the same route, not converging on each other
SAME_DIRECTION_DEG = 35.0


def _travel_heading(machine) -> float:
    h = machine.heading_deg
    return (h + 180.0) % 360.0 if machine.intent == "reverse" else h


def _heading_delta(a, b) -> float:
    d = abs(_travel_heading(a) - _travel_heading(b)) % 360.0
    return min(d, 360.0 - d)


def _at_service_point(x: float, y: float) -> bool:
    return any(math.dist((x, y), p) < SERVICE_RADIUS_M for p in SERVICE_POINTS)


def envelope_m(machine) -> float:
    """Machine-to-machine conflict radius.

    Deliberately *not* the person bubble from `physics.bubble_radii` - that one
    is sized for a human on foot.  Here it is the machine's own footprint (or
    its swing envelope, for an excavator mid-slew) plus the distance it covers
    while the operator reacts.
    """
    body = max(machine.spec.track_half_length, machine.swing_radius_m)
    return body + REACTION_S * machine.speed_mps


def _extrapolate(machine, t: float) -> tuple[float, float]:
    """Where a machine will be in t seconds at its current heading and speed."""
    heading = machine.heading_deg
    if machine.intent == "reverse":
        heading = (heading + 180.0) % 360.0
    rad = math.radians(heading)
    # heading 0 = north (+y), clockwise
    return (
        machine.x + math.sin(rad) * machine.speed_mps * t,
        machine.y + math.cos(rad) * machine.speed_mps * t,
    )


def path_of(machine, horizon_s: float = V2V_HORIZON_S) -> list[list[float]]:
    steps = int(horizon_s / STEP_S)
    return [
        [round(v, 2) for v in _extrapolate(machine, i * STEP_S)]
        for i in range(steps + 1)
    ]


def check_v2v(machines: list, bus: EventBus, sim_time_s: float,
              last_pair: dict[tuple[str, str], float]) -> list[dict]:
    """Pairwise forward simulation; emits `v2v_collision_risk` on conflict."""
    emitted: list[dict] = []
    moving = [m for m in machines if m.engine_on]
    for i, a in enumerate(moving):
        for b in moving[i + 1:]:
            if math.dist((a.x, a.y), (b.x, b.y)) > V2V_SCAN_RADIUS_M:
                continue
            if a.speed_mps < 0.2 and b.speed_mps < 0.2:
                continue
            if (
                a.speed_mps > 0.2 and b.speed_mps > 0.2
                and _heading_delta(a, b) < SAME_DIRECTION_DEG
            ):
                continue            # convoy / same lane, not a conflict

            threshold = envelope_m(a) + envelope_m(b)

            now_d = math.dist((a.x, a.y), (b.x, b.y))
            if now_d <= threshold:
                # already overlapping - that is a proximity problem, not a
                # prediction; leave it to the proximity rule
                continue

            conflict_t = None
            min_d = 1e9
            steps = int(V2V_HORIZON_S / STEP_S)
            for s in range(1, steps + 1):
                t = s * STEP_S
                d = math.dist(_extrapolate(a, t), _extrapolate(b, t))
                if d < min_d:
                    min_d = d
                if d < threshold and conflict_t is None:
                    conflict_t = t
            if conflict_t is None:
                continue
            if min_d >= now_d - 1.0:
                # not actually closing on each other
                continue

            ax, ay = _extrapolate(a, conflict_t)
            bx, by = _extrapolate(b, conflict_t)
            if _at_service_point((ax + bx) / 2, (ay + by) / 2):
                continue

            key = (a.machine_id, b.machine_id)
            if sim_time_s - last_pair.get(key, -1e9) < V2V_DEBOUNCE_S:
                continue
            last_pair[key] = sim_time_s

            evt = bus.emit(
                "v2v_collision_risk", "high",
                f"{a.machine_id} and {b.machine_id} on converging paths - "
                f"{conflict_t:.1f} s to conflict",
                a.machine_id, "v2v",
                {
                    "machine_a": a.machine_id,
                    "machine_b": b.machine_id,
                    "time_to_conflict_s": round(conflict_t, 1),
                    "min_distance_m": round(min_d, 1),
                    "path_a": path_of(a),
                    "path_b": path_of(b),
                },
                sim_time_s, force=True,
            )
            if evt:
                emitted.append(evt)
    return emitted


def check_v2i(machines: list, bus: EventBus, sim_time_s: float, world) -> list[dict]:
    """Node-driven advisories: fuel bay availability, loader queue depth, gate."""
    emitted: list[dict] = []
    fuel_node = next(n for n in V2I_NODES if n.node_type == "fuel_bay")
    gate_node = next(n for n in V2I_NODES if n.node_type == "gate")
    queue_node = next(n for n in V2I_NODES if n.node_type == "loader_queue")

    bay_busy = any(
        math.dist((m.x, m.y), (fuel_node.x, fuel_node.y)) < 15.0 for m in machines
    )
    for m in machines:
        if m.fuel_level_pct >= FUEL_LOW_PCT:
            continue
        suggestion = (
            "Fuel bay busy - refuel after current task" if bay_busy
            else "Fuel bay is free now - refuel before your next task"
        )
        evt = bus.emit(
            "v2i_suggestion", "info", suggestion, m.machine_id, "v2i",
            {"node_id": fuel_node.node_id, "node_type": "fuel_bay",
             "suggestion": suggestion},
            sim_time_s, debounce_s=ADVISORY_DEBOUNCE_S,
        )
        if evt:
            emitted.append(evt)

    queued = [
        m for m in machines
        if m.machine_type == "truck" and getattr(m, "truck_mode", "") == "queue"
        and m.machine_id != world.loader_holder
    ]
    if len(queued) >= QUEUE_DEEP:
        suggestion = (
            f"Loader queue is {len(queued)} deep - hold at dump area"
        )
        evt = bus.emit(
            "v2i_suggestion", "info", suggestion, queued[-1].machine_id, "v2i",
            {"node_id": queue_node.node_id, "node_type": "loader_queue",
             "suggestion": suggestion, "queue_depth": len(queued)},
            sim_time_s, debounce_s=ADVISORY_DEBOUNCE_S,
        )
        if evt:
            emitted.append(evt)

    if world.gate_occupied:
        near_gate = [
            m for m in machines
            if math.dist((m.x, m.y), (gate_node.x, gate_node.y)) < 60.0
        ]
        for m in near_gate:
            suggestion = "Gate occupied - use alternate route"
            evt = bus.emit(
                "v2i_suggestion", "info", suggestion, m.machine_id, "v2i",
                {"node_id": gate_node.node_id, "node_type": "gate",
                 "suggestion": suggestion},
                sim_time_s, debounce_s=ADVISORY_DEBOUNCE_S,
            )
            if evt:
                emitted.append(evt)
    return emitted
