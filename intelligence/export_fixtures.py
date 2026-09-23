"""Regenerate every file in `fixtures/`.

    uv run python -m intelligence.export_fixtures

The rule that makes fixtures worth having: **they are produced by the same code
paths as live data**.  D builds every screen against these files, and when the
live stream arrives the screens just work, because the shapes cannot drift.

`events.json` carries one example of every event in the catalogue, produced by
actually running the scenarios rather than hand-written.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from simulator.scenarios import SCENARIOS, ScenarioEngine
from simulator.schemas import EVENT_CATALOGUE, Event, MachineState, Task, WorkerState
from simulator.site import SITE_LAYOUT
from simulator.world import World

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"


def _write(name: str, payload) -> tuple[str, int]:
    path = FIXTURES / name
    text = json.dumps(payload, indent=2)
    path.write_text(text)
    size = len(text)
    count = len(payload) if isinstance(payload, list) else 1
    return f"{name:28s} {count:>5} item(s)  {size / 1024:6.1f} KB", size


def collect_live() -> tuple[World, list[dict], list[dict], list[dict]]:
    """Run the world, fire every scenario, and keep one of each event type."""
    world = World(seed=42)
    engine = ScenarioEngine(world)
    for _ in range(120):
        world.tick()

    seen: dict[str, dict] = {}
    for evt in world.bus.history:
        seen.setdefault(evt["event"], evt)

    for info in SCENARIOS:
        if info.name == "reset":
            continue
        engine.trigger(info.name)
        for _ in range(25):
            world.tick()
        if info.name == "unbuckle":
            # `buckle` only emits if the belt was actually off, and the reset
            # below would clear that state - so run the pair in sequence
            engine.trigger("buckle")
            for _ in range(3):
                world.tick()
        for evt in world.bus.history:
            seen.setdefault(evt["event"], evt)
        engine.trigger("reset")
        for _ in range(3):
            world.tick()

    # the catalogue lists one event B creates, not C - include a representative
    # example so D can style it without waiting for B
    if "incident_created" not in seen:
        seen["incident_created"] = {
            "type": "event",
            "id": "evt_999001",
            "ts": world.bus.history[-1]["ts"] if world.bus.history else "2026-09-23T10:15:00Z",
            "event": "incident_created",
            "severity": "high",
            "machine_id": "EXC001",
            "source": "rules",
            "message": "Incident INC-0042 created from proximity alert",
            "data": {"incident_id": "INC-0042", "created_by": "backend",
                     "source_event": "proximity_alert"},
        }

    missing = [e for e in EVENT_CATALOGUE if e not in seen]
    if missing:
        raise SystemExit(
            f"no example produced for: {missing}\n"
            "every event in the catalogue must appear in events.json"
        )

    machine_states = list(world.last_states.values())
    worker_states = list(world.last_worker_states.values())
    events = [seen[name] for name in EVENT_CATALOGUE] + [seen["incident_created"]]
    return world, machine_states, worker_states, events


def validate(machine_states, worker_states, events, tasks) -> None:
    """Fixtures must satisfy the same contracts as live messages."""
    for s in machine_states:
        MachineState.model_validate(s)
    for s in worker_states:
        WorkerState.model_validate(s)
    for e in events:
        Event.model_validate(e)
    for t in tasks:
        Task.model_validate(t)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Regenerate fixtures/")
    ap.add_argument("--skip-whatif", action="store_true",
                    help="what-if runs two headless shifts and takes ~25 s")
    args = ap.parse_args(argv)

    FIXTURES.mkdir(exist_ok=True)
    from .anomaly import get_anomalies
    from .maintenance import get_maintenance_forecast
    from .risk import get_working_risk
    from .summaries import (
        fleet_kpis, heatmap_points, incident_index, leaderboard,
        owner_summary, training_profiles, utilization_series,
    )
    from .task_time import predict_task_time

    print("running the simulator to capture live-shaped fixtures...")
    world, machine_states, worker_states, events = collect_live()
    tasks = world.tasks.all_tasks()
    validate(machine_states, worker_states, events, tasks)
    print("  contracts validated\n")

    written = []
    written.append(_write("site_layout.json", SITE_LAYOUT))
    written.append(_write("machine_state.json", machine_states))
    written.append(_write("worker_state.json", worker_states))
    written.append(_write("events.json", events))
    written.append(_write("tasks.json", tasks))
    written.append(_write("scenarios.json", [
        {"name": s.name, "label": s.label, "description": s.description}
        for s in SCENARIOS
    ]))

    written.append(_write("fleet_kpis.json", fleet_kpis(world.snapshot())))
    written.append(_write("owner_summary.json", owner_summary(7)))
    written.append(_write("utilization_series.json", utilization_series(30)))
    written.append(_write("leaderboard.json", leaderboard()))
    written.append(_write("training_profiles.json", training_profiles()))
    written.append(_write("incidents.json", incident_index()))
    written.append(_write("heatmap_near_miss.json", heatmap_points("near_miss")))
    written.append(_write("heatmap_idle.json", heatmap_points("idle")))

    # D needs a varied set, and the seatbelt+idle case is the one the pitch
    # is built on, so make sure it is in there rather than hoping
    pool = get_anomalies(since_hours=24 * 30)
    chosen: list[dict] = []
    seatbelt = next((a for a in pool if a["type"] == "seatbelt_violation"), None)
    if seatbelt:
        chosen.append(seatbelt)
    for a in pool:
        if len(chosen) >= 5:
            break
        if a in chosen:
            continue
        if a["type"] not in {c["type"] for c in chosen} or len(chosen) < 3:
            chosen.append(a)
    written.append(_write("anomalies.json", chosen))
    written.append(_write("maintenance.json", get_maintenance_forecast()))

    example_task = next(
        (t for t in tasks if t["task_type"] == "trenching"), tasks[0]
    )
    written.append(_write("task_estimate.json", predict_task_time({
        "task_type": example_task["task_type"],
        "machine_model": "320",
        "operator_skill": "intermediate",
        "soil": example_task["soil"],
        "weather": "rain",
        "volume_m3": example_task["volume_m3"],
        "operator_years": 6,
        "temperature_c": 33,
        "visibility_m": 300,
        "site_congestion": 0.6,
        "time_of_day": 10,
        "machine_health": 0.78,
        "estimated_time_min": example_task["estimate"]["p50"],
    })))
    written.append(_write("working_risk.json", get_working_risk(
        weather="rain", temperature_c=36, visibility_m=300,
        ground="wet", hours_on_shift=9, fatigue_score=0.4,
    )))

    if not args.skip_whatif:
        from .whatif import run_what_if
        print("  running what-if (two headless shifts)...")
        written.append(_write("whatif.json", run_what_if(
            {"trucks": 6, "weather": "rain", "add_spotter": True}
        )))

    for line, _ in written:
        print("  " + line)
    total = sum(size for _, size in written)
    print(f"\n{len(written)} fixtures written to {FIXTURES} ({total / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
