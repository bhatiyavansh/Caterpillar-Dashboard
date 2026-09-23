"""Contract tests.

Person A, B and D all build against the shapes in `simulator/schemas.py`.  If
one of these fails, three other people's screens break - fix the emitter, not
the schema, unless the whole team has agreed to the change.
"""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from simulator.scenarios import SCENARIOS, ScenarioEngine
from simulator.schemas import (
    EVENT_CATALOGUE,
    Event,
    MachineState,
    Task,
    WorkerState,
)
from simulator.site import lane_separation_min
from simulator.world import World

TICKS = 300


@pytest.fixture(scope="module")
def run():
    world = World(seed=42)
    engine = ScenarioEngine(world)
    messages: list[dict] = []
    for _ in range(TICKS):
        messages.extend(world.tick())
    return world, engine, messages


def test_every_message_validates(run):
    _, _, messages = run
    models = {
        "machine_state": MachineState,
        "worker_state": WorkerState,
        "event": Event,
    }
    assert messages, "simulator produced no messages"
    for msg in messages:
        model = models.get(msg["type"])
        assert model is not None, f"unknown message type {msg['type']}"
        try:
            model.model_validate(msg)
        except ValidationError as exc:
            pytest.fail(f"{msg['type']} failed the contract: {exc}\n{msg}")


def test_message_rates(run):
    _, _, messages = run
    machine_states = [m for m in messages if m["type"] == "machine_state"]
    worker_states = [m for m in messages if m["type"] == "worker_state"]
    assert len(machine_states) == 9 * TICKS       # 1 Hz per machine
    assert len(worker_states) == 6 * TICKS        # 1 Hz per worker


def test_every_message_is_json_safe(run):
    _, _, messages = run
    for msg in messages:
        json.dumps(msg)      # raises on numpy types, NaN handled below
    text = json.dumps(messages)
    assert "NaN" not in text and "Infinity" not in text


def test_tasks_validate(run):
    world, _, _ = run
    tasks = world.tasks.all_tasks()
    assert len(tasks) == 27                       # 9 machines x 3 tasks
    for task in tasks:
        Task.model_validate(task)


def test_values_are_plausible(run):
    _, _, messages = run
    for m in (m for m in messages if m["type"] == "machine_state"):
        assert 0 <= m["pos"]["x"] <= 400 and 0 <= m["pos"]["y"] <= 300
        assert 0 <= m["fuel_level_pct"] <= 100
        assert 0 <= m["fatigue_score"] <= 1
        assert 0 <= m["task_progress"] <= 1
        assert 0.3 <= m["tip_over_margin"] <= 5.0
        assert 0 <= m["speed_mps"] <= 20
        assert 30 <= m["hydraulic_temp_c"] <= 130
        assert 0 <= m["heading_deg"] < 360
        assert m["payload_kg"] >= 0
        assert m["task_eta_min"] >= 0


def test_bubble_matches_distance(run):
    _, _, messages = run
    for m in (m for m in messages if m["type"] == "machine_state"):
        if m["bubble"] == "green":
            assert m["nearest_person_m"] > 5.0


@pytest.mark.parametrize("info", SCENARIOS, ids=lambda s: s.name)
def test_every_scenario_runs_and_emits_valid_events(info):
    world = World(seed=7)
    engine = ScenarioEngine(world)
    for _ in range(30):
        world.tick()

    before = len(world.bus.history)
    result = engine.trigger(info.name)
    assert result["ok"], result
    for _ in range(40):
        world.tick()

    for evt in world.bus.history[before:]:
        Event.model_validate(evt)
        assert evt["event"] in EVENT_CATALOGUE, f"{evt['event']} is not in the catalogue"

    if info.name != "reset":
        produced = {e["event"] for e in world.bus.history[before:]}
        assert produced, f"scenario {info.name} produced no events at all"


def test_reset_clears_overrides():
    world = World(seed=3)
    engine = ScenarioEngine(world)
    for _ in range(10):
        world.tick()
    engine.trigger("heavy_lift")
    engine.trigger("rain")
    world.tick()
    assert world.weather == "rain"
    assert world.by_id["EXC001"].tip_over_margin < 1.2

    engine.trigger("reset")
    for _ in range(5):
        world.tick()
    assert world.weather == "clear"
    assert world.ground == "dry"
    assert world.by_id["EXC001"].ov_payload_kg is None
    assert world.by_id["EXC001"].tip_over_margin > 1.2


def test_determinism():
    a = [m for m in World(seed=42).tick()]
    w = World(seed=42)
    b = [m for m in w.tick()]
    strip = lambda ms: [{k: v for k, v in m.items() if k != "ts"} for m in ms]
    assert strip(a) == strip(b)


def test_haul_lanes_do_not_trip_v2v():
    """Routine haul traffic must never look like a collision risk."""
    assert lane_separation_min() > 20.0
