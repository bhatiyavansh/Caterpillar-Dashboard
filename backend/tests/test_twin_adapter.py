"""TwinAdapter against frames captured from Person A's real engine (scripts/capture_twin_fixture.mjs)."""

import json
import math

import pytest

from copilot.adapters import twin_mapping as tm
from copilot.adapters.twin import TwinAdapter
from tests.conftest import FIXTURES

FRAMES = [f["frame"] for f in json.loads((FIXTURES / "twin_snapshots.json").read_text())["frames"]]


def test_machines_ids_units_and_frame():
    ad = TwinAdapter()
    items = ad.normalize(FRAMES[0])
    machines = {i.payload["machine_id"]: i.payload for i in items if i.kind == "machine"}
    assert set(machines) == {"EXC001", "DOZ001", "WHL001", "TRK001"}
    raw = next(m for m in FRAMES[0]["snapshot"]["machines"] if m["machineId"] == "EXC001")
    exc = machines["EXC001"]
    assert exc["pos"]["x"] == pytest.approx(raw["x"] + 200.0)
    assert exc["pos"]["y"] == pytest.approx(-raw["z"] + 150.0)  # -Z north -> +y north
    assert exc["heading_deg"] == pytest.approx(math.degrees(raw["heading"]) % 360, abs=0.05)
    assert exc["boom_angle_deg"] == pytest.approx(math.degrees(raw["boomAngle"]), abs=0.01)
    for missing in ("seatbelt", "operator_id", "engine_hours", "idle_min", "load_cycles", "zone"):
        assert missing not in exc, f"{missing} must be absent, never invented"
    assert ad.stats.rejected == 0


def test_nearest_null_means_nobody_tracked():
    t = {"machineId": "DZR001", "x": 0, "z": 0, "nearestPerson": None, "activity": "idle"}
    p = tm.machine_payload(t, "2026-09-23T00:00:00Z", None)
    assert p["nearest_person_m"] == 99.0 and p["bubble"] == "green"


def test_alert_appears_once_as_event():
    ad = TwinAdapter()
    events = []
    for f in FRAMES:
        events += [i.payload for i in ad.normalize(f) if i.kind == "event"]
    kinds = [e["event"] for e in events]
    assert kinds.count("proximity_alert") == 1  # stays open across frames -> emitted once
    prox = next(e for e in events if e["event"] == "proximity_alert")
    assert prox["severity"] == "critical" and prox["machine_id"] == "EXC001"
    assert prox["data"]["twin_alert_id"] == "proximity:EXC001"
    assert kinds.count("weather_change") == 1  # from snapshot.weather diff, not the twin's weather alert


def test_workers_mapped():
    items = TwinAdapter().normalize(FRAMES[0])
    ids = sorted(i.payload["worker_id"] for i in items if i.kind == "worker")
    assert ids == ["W01", "W02", "W03", "W04", "W05", "W06"]


def test_round_trip_geometry():
    for x, z in [(0, 0), (-130, 130), (55.5, -12.25)]:
        sx, sy = tm.twin_to_site(x, z)
        assert tm.site_to_twin(sx, sy) == pytest.approx((x, z))
