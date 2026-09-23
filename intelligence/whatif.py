"""What-if: run the site headless and compare against the current setup.

No sleeping, no WebSocket - just the same World stepped as fast as Python can,
so a 10-hour shift takes a couple of seconds.  Because it is the *same*
simulator the live demo runs on, the comparison is honest rather than a
formula dressed up as a simulation.
"""

from __future__ import annotations

from simulator.config import SEED
from simulator.scenarios import ScenarioEngine
from simulator.world import World

DEFAULT_SHIFT_HOURS = 10.0
STEP_S = 2.0            # coarser than the live 1 Hz tick, for speed.  Near-miss
                        # counts are correspondingly approximate - the headline
                        # numbers here are throughput, fuel, idle and risk.


def _run(params: dict, seed: int = SEED) -> dict:
    world = World(seed=seed)
    engine = ScenarioEngine(world)

    trucks = int(params.get("trucks", 4))
    weather = str(params.get("weather", "clear"))
    shift_hours = float(params.get("shift_hours", DEFAULT_SHIFT_HOURS))
    add_spotter = bool(params.get("add_spotter", False))
    road_closed = bool(params.get("road_closed", False))

    # fewer trucks: park the surplus.  more than we have: not simulatable, so
    # the extra ones are reported as unavailable rather than faked
    haulers = [m for m in world.machines if m.machine_type == "truck"]
    for m in haulers[trucks:]:
        m.engine_on = False
    requested_extra = max(0, trucks - len(haulers))

    if weather != "clear":
        world.weather = weather
        if weather == "rain":
            engine.trigger("rain")
    if road_closed:
        world.gate_occupied = True
    if add_spotter:
        # a spotter keeps the crew further from the machines
        import simulator.worker as worker_module
        worker_module.STANDOFF_M = 22.0

    steps = int(shift_hours * 3600 / STEP_S)
    near_misses = 0
    for _ in range(steps):
        world.tick(STEP_S)
        near_misses += sum(
            1 for e in world.bus.pending
            if e["event"] in ("proximity_alert", "v2v_collision_risk")
        )
        world.bus.pending.clear()

    if add_spotter:
        import simulator.worker as worker_module
        worker_module.STANDOFF_M = 14.0

    states = list(world.last_states.values())
    on = [s for s in states if s["engine_on"]]
    fuel_l = sum(s["fuel_used_l"] for s in states)
    idle_min = sum(s["idle_min"] for s in states)
    total_min = shift_hours * 60 * max(len(on), 1)
    # only the task types actually measured in cubic metres go into
    # throughput_m3 - grading is m2 and hauling is truck loads, and summing
    # them together would produce a number that means nothing
    tasks = world.tasks.all_tasks()
    throughput = sum(
        t["volume_m3"] * t["progress"]
        for t in tasks if t["task_type"] in ("trenching", "dozing")
    )
    graded_m2 = sum(
        t["volume_m3"] * t["progress"] for t in tasks if t["task_type"] == "grading"
    )
    loads = sum(
        t["volume_m3"] * t["progress"]
        for t in tasks if t["task_type"] in ("hauling", "loading")
    )

    from .risk import get_working_risk
    risk = get_working_risk(
        weather=world.weather, temperature_c=world.temperature_c,
        visibility_m=world.visibility_m, ground=world.ground,
        hours_on_shift=shift_hours,
    )

    result = {
        "throughput_m3": round(throughput),
        "graded_m2": round(graded_m2),
        "truck_loads": round(loads),
        "tasks_completed": sum(1 for t in tasks if t["status"] == "done"),
        "fuel_l": round(fuel_l),
        "idle_pct": round(idle_min / total_min * 100, 1),
        "risk": risk["score"],
        "near_misses": near_misses,
        "active_machines": len(on),
    }
    if requested_extra:
        result["note"] = (
            f"{requested_extra} extra truck(s) requested beyond the {len(haulers)} "
            "on site - not simulated"
        )
    return result


def _delta(current: dict, scenario: dict) -> dict:
    def pct(a, b):
        if not a:
            return "n/a"
        return f"{(b - a) / a * 100:+.0f}%"

    return {
        "throughput_m3": pct(current["throughput_m3"], scenario["throughput_m3"]),
        "truck_loads": pct(current["truck_loads"], scenario["truck_loads"]),
        "tasks_completed": f"{scenario['tasks_completed'] - current['tasks_completed']:+d}",
        "fuel_l": pct(current["fuel_l"], scenario["fuel_l"]),
        "idle_pct": f"{scenario['idle_pct'] - current['idle_pct']:+.1f} pts",
        "risk": f"{scenario['risk'] - current['risk']:+d}",
        "near_misses": f"{scenario['near_misses'] - current['near_misses']:+d}",
    }


def run_what_if(params: dict) -> dict:
    """Compare the current site setup against a changed one.

    params: {"trucks", "weather", "shift_hours", "road_closed", "add_spotter"}
    """
    baseline = {
        "trucks": 4, "weather": "clear",
        "shift_hours": float(params.get("shift_hours", DEFAULT_SHIFT_HOURS)),
        "road_closed": False, "add_spotter": False,
    }
    current = _run(baseline)
    scenario = _run({**baseline, **params})
    return {
        "params": params,
        "current": current,
        "scenario": scenario,
        "delta": _delta(current, scenario),
    }
