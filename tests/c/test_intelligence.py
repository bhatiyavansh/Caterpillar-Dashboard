"""Tests for the `intelligence` package.

Person B imports these functions straight into a FastAPI process and hands the
results to an LLM, so two things matter beyond correctness: every return value
must be JSON-serialisable with no numpy types or NaN, and nothing may take long
enough to stall a request.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

import pytest

from intelligence import (
    fleet_kpis,
    get_anomalies,
    get_maintenance_forecast,
    get_working_risk,
    heatmap_points,
    incident_index,
    leaderboard,
    owner_summary,
    predict_remaining,
    predict_task_time,
    score_brief_sample,
    training_profiles,
    utilization_series,
)

DATA = Path(__file__).resolve().parents[2] / "data"
FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
needs_data = pytest.mark.skipif(
    not (DATA / "telemetry.csv").exists(),
    reason="run data-gen/generate.py first",
)
BUDGET_S = 0.3      # B calls these inside a request


def assert_json_safe(value, where: str = "root") -> None:
    """No numpy scalars, no NaN, no datetimes - B sends this straight to JSON."""
    text = json.dumps(value)          # raises TypeError on numpy/datetime
    assert "NaN" not in text, f"{where} contains NaN"
    assert "Infinity" not in text, f"{where} contains Infinity"

    def walk(v, path):
        if isinstance(v, float):
            assert math.isfinite(v), f"{path} is not finite"
        elif isinstance(v, dict):
            for k, item in v.items():
                assert isinstance(k, str), f"{path}.{k} is not a string key"
                walk(item, f"{path}.{k}")
        elif isinstance(v, list):
            for i, item in enumerate(v):
                walk(item, f"{path}[{i}]")
        else:
            assert v is None or isinstance(v, (str, int, bool)), \
                f"{path} is {type(v).__name__}, not a JSON primitive"

    walk(value, where)


# --------------------------------------------------------------------------
# risk: pure rules, always available
# --------------------------------------------------------------------------

def test_working_risk_shape_and_levels():
    out = get_working_risk()
    assert_json_safe(out, "get_working_risk")
    assert set(out) == {"score", "level", "reasons"}
    assert out["level"] == "low"

    severe = get_working_risk(
        weather="rain", temperature_c=41, visibility_m=250,
        ground="muddy", hours_on_shift=10, fatigue_score=0.9,
    )
    assert severe["level"] == "high"
    assert severe["score"] > out["score"]
    assert 0 <= severe["score"] <= 100
    assert severe["reasons"]


def test_working_risk_is_monotonic_in_each_hazard():
    base = dict(weather="clear", temperature_c=30, visibility_m=10_000,
                ground="dry", hours_on_shift=1, fatigue_score=0.0)
    baseline = get_working_risk(**base)["score"]
    for worse in (
        {"weather": "rain"}, {"visibility_m": 300}, {"ground": "muddy"},
        {"temperature_c": 42}, {"hours_on_shift": 10}, {"fatigue_score": 0.9},
    ):
        assert get_working_risk(**{**base, **worse})["score"] > baseline, worse


# --------------------------------------------------------------------------
# task time
# --------------------------------------------------------------------------

def test_predict_task_time_shape():
    task = {"task_type": "trenching", "machine_model": "320", "volume_m3": 120,
            "soil": "clay", "weather": "clear", "operator_skill": "intermediate"}
    out = predict_task_time(task)
    assert_json_safe(out, "predict_task_time")
    assert out["p10"] <= out["p50"] <= out["p90"], "quantiles must not cross"
    assert out["p50"] > 0
    assert out["unit"] == "min"
    for reason in out["reasons"]:
        assert set(reason) == {"feature", "label", "impact_min"}


def test_predict_task_time_responds_to_conditions():
    base = {"task_type": "trenching", "machine_model": "320", "volume_m3": 120,
            "soil": "mixed", "weather": "clear", "operator_skill": "expert",
            "site_congestion": 0.1}
    easy = predict_task_time(base)["p50"]
    hard = predict_task_time({
        **base, "weather": "rain", "soil": "rock",
        "operator_skill": "novice", "site_congestion": 0.9,
    })["p50"]
    assert hard > easy * 1.2, f"rain/rock/novice ({hard}) should beat clear/expert ({easy})"


def test_predict_remaining_scales_with_progress():
    task = {"task_type": "trenching", "machine_model": "320", "volume_m3": 120}
    full = predict_task_time(task)["p50"]
    half = predict_remaining(task, 0.5)["p50"]
    done = predict_remaining(task, 1.0)["p50"]
    assert done == 0
    assert abs(half - full / 2) < 1.0


def test_predict_task_time_is_fast():
    task = {"task_type": "loading", "machine_model": "950", "volume_m3": 15}
    predict_task_time(task)                      # warm the lazy load
    started = time.perf_counter()
    predict_task_time(task)
    assert time.perf_counter() - started < BUDGET_S


# --------------------------------------------------------------------------
# anomalies
# --------------------------------------------------------------------------

@needs_data
def test_get_anomalies_shape():
    found = get_anomalies(since_hours=24 * 7)
    assert_json_safe(found, "get_anomalies")
    assert found, "a month of data with injected anomalies should flag something"
    for a in found:
        assert set(a) >= {
            "anomaly_id", "machine_id", "operator_id", "type", "related",
            "score", "window", "evidence", "fuel_wasted_l", "fuel_cost_inr",
        }
        assert 0 <= a["score"] <= 1
        assert a["type"] not in a["related"], "primary type repeated in related"
        assert a["fuel_cost_inr"] >= 0


@needs_data
def test_flags_exactly_the_briefs_alert_rows():
    """The headline claim: we flag the rows the brief marked, and only those."""
    rows = score_brief_sample()
    assert len(rows) == 4
    assert_json_safe(rows, "score_brief_sample")
    for r in rows:
        assert r["flagged"] == r["expected_alert"], (
            f"{r['timestamp']}: expected_alert={r['expected_alert']} "
            f"but flagged={r['flagged']} ({r['types']})"
        )
    flagged = [r for r in rows if r["flagged"]]
    assert len(flagged) == 2
    for r in flagged:
        assert "seatbelt_violation" in r["types"]
        assert "excessive_idling" in r["types"]


@needs_data
def test_brief_rows_are_really_in_the_telemetry():
    """The four rows must aggregate back out of our own per-minute history."""
    import pandas as pd

    telemetry = pd.read_csv(DATA / "telemetry.csv", parse_dates=["timestamp"])
    brief = telemetry[telemetry["task_id"] == "BRIEF"]
    given = pd.read_csv(DATA / "brief_sample.csv")
    assert len(brief) == 4 * 120, "each brief row should be 120 minutes"

    for _, row in given.iterrows():
        start = pd.Timestamp(row["timestamp"])
        window = brief[
            (brief["timestamp"] >= start)
            & (brief["timestamp"] <= start + pd.Timedelta(minutes=119))
        ]
        assert round(window["fuel_used_l"].sum(), 1) == row["fuel_used_l"]
        assert int(window["load_cycles"].sum()) == row["load_cycles"]
        assert int(window["idle_min"].sum()) == row["idling_time_min"]


# --------------------------------------------------------------------------
# summaries
# --------------------------------------------------------------------------

@needs_data
@pytest.mark.parametrize("fn,name", [
    (fleet_kpis, "fleet_kpis"),
    (lambda: owner_summary(7), "owner_summary"),
    (lambda: utilization_series(30), "utilization_series"),
    (leaderboard, "leaderboard"),
    (training_profiles, "training_profiles"),
    (incident_index, "incident_index"),
    (lambda: heatmap_points("near_miss"), "heatmap_near_miss"),
    (lambda: heatmap_points("idle"), "heatmap_idle"),
    (get_maintenance_forecast, "maintenance"),
])
def test_summary_outputs_are_json_safe(fn, name):
    out = fn()
    assert_json_safe(out, name)
    assert out or name == "maintenance"


@needs_data
def test_scores_are_in_range_and_ranked():
    board = leaderboard()
    assert board
    for r in board:
        assert 0 <= r["safety_score"] <= 100
        assert 0 <= r["efficiency_score"] <= 100
        assert 0 <= r["seatbelt_compliance_pct"] <= 100
    ranks = [r["rank"] for r in board]
    assert ranks == sorted(ranks) == list(range(1, len(board) + 1))


@needs_data
def test_novices_rank_below_experts():
    """If the leaderboard does not separate skill levels it is just noise."""
    profiles = {p["operator_id"]: p["skill"] for p in training_profiles()}
    board = leaderboard()
    by_skill: dict[str, list[int]] = {}
    for r in board:
        by_skill.setdefault(profiles.get(r["operator_id"], "?"), []).append(
            r["safety_score"]
        )
    expert = sum(by_skill["expert"]) / len(by_skill["expert"])
    novice = sum(by_skill["novice"]) / len(by_skill["novice"])
    assert expert > novice, f"expert mean {expert} should beat novice mean {novice}"


@needs_data
def test_maintenance_forecast_is_ordered_and_plausible():
    forecast = get_maintenance_forecast()
    assert forecast
    hours = [f["hours_to_service"] for f in forecast]
    assert hours == sorted(hours), "most urgent first"
    for f in forecast:
        assert 0 <= f["health_pct"] <= 100
        assert f["confidence"] in ("low", "medium", "high")
        assert f["recommended_parts"]


# --------------------------------------------------------------------------
# fixtures
# --------------------------------------------------------------------------

@pytest.mark.skipif(not (FIXTURES / "events.json").exists(),
                    reason="run intelligence.export_fixtures first")
def test_fixtures_match_the_contracts():
    """D builds against these files; they must be valid live shapes."""
    from simulator.schemas import EVENT_CATALOGUE, Event, MachineState, Task, WorkerState

    load = lambda n: json.loads((FIXTURES / n).read_text())

    for state in load("machine_state.json"):
        MachineState.model_validate(state)
    for state in load("worker_state.json"):
        WorkerState.model_validate(state)
    for task in load("tasks.json"):
        Task.model_validate(task)

    events = load("events.json")
    for event in events:
        Event.model_validate(event)
    present = {e["event"] for e in events}
    missing = set(EVENT_CATALOGUE) - present
    assert not missing, f"events.json is missing examples of: {sorted(missing)}"


@pytest.mark.skipif(not (FIXTURES / "scenarios.json").exists(),
                    reason="run intelligence.export_fixtures first")
def test_every_scenario_has_a_director_button():
    from simulator.scenarios import SCENARIOS

    listed = {s["name"] for s in json.loads((FIXTURES / "scenarios.json").read_text())}
    assert listed == {s.name for s in SCENARIOS}
