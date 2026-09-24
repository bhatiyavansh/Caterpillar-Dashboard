import json

from copilot.adapters.base import AdapterStats, validate_contract_frame
from copilot.config import REPO_DIR
from copilot.contracts import codegen
from copilot.contracts.models import LiveEvent, LiveMachineState
from simulator.schemas import MachineState

C_FIXTURES = REPO_DIR / "fixtures"

# README §10 examples, verbatim (README copy.md lines 314-360)
README_MACHINE_STATE = {
    "type": "machine_state", "ts": "2026-09-23T10:15:02Z", "machine_id": "EXC001", "model": "320",
    "operator_id": "OP1001", "pos": {"x": 120.4, "y": 88.1, "lat": 13.0827, "lon": 80.2707},
    "heading_deg": 142.5, "speed_mps": 1.2, "intent": "swing_left", "engine_hours": 1523.5,
    "fuel_level_pct": 64, "fuel_used_l": 5.2, "load_cycles": 12, "idle_min": 30, "seatbelt": "fastened",
    "payload_kg": 1850, "hydraulic_temp_c": 71, "pitch_deg": 4.1, "roll_deg": 1.3,
    "tip_over_margin": 1.62, "bubble": "green", "task_id": "T-0042", "task_progress": 0.62,
}
README_EVENT = {
    "type": "event", "ts": "2026-09-23T10:15:04Z", "event": "proximity_alert", "severity": "high",
    "machine_id": "EXC001", "source": "webcam", "data": {"distance_m": 2.8, "zone": "rear"},
}


def test_generated_files_are_fresh_and_additive():
    assert codegen.check() == 0


def test_c_fixtures_validate_strictly():
    stats = AdapterStats()
    frames = json.loads((C_FIXTURES / "machine_state.json").read_text())
    frames += json.loads((C_FIXTURES / "worker_state.json").read_text())
    frames += json.loads((C_FIXTURES / "events.json").read_text())
    for f in frames:
        assert validate_contract_frame(f, stats)
    assert stats.lenient == 0 and stats.rejected == 0
    assert stats.accepted == len(frames)


def test_readme_section10_examples_are_accepted_leniently():
    stats = AdapterStats()
    [m] = validate_contract_frame(dict(README_MACHINE_STATE), stats)
    assert m.payload["machine_id"] == "EXC001"
    [e] = validate_contract_frame(dict(README_EVENT), stats)
    # README event lacks C's required id/message: the hub stamps them rather than dropping it
    assert e.payload["id"].startswith("hub_") and e.payload["message"] == "proximity_alert"
    assert stats.lenient == 1  # the machine_state lacks C-required fields (machine_type, status, ...)
    assert stats.rejected == 0


def test_hard_required_fields_are_enforced():
    stats = AdapterStats()
    assert validate_contract_frame({"type": "machine_state", "ts": "x"}, stats) == []
    assert validate_contract_frame({"type": "nonsense"}, stats) == []
    assert stats.rejected == 1 and stats.unknown_types["nonsense"] == 1


def test_live_models_extend_c_models():
    base = json.loads((C_FIXTURES / "machine_state.json").read_text())[0]
    MachineState.model_validate(base)
    LiveMachineState.model_validate({**base, "seq": 1, "epoch": "e", "hub_ts": "t"})
    evt = json.loads((C_FIXTURES / "events.json").read_text())[0]
    LiveEvent.model_validate({**evt, "seq": 2, "epoch": "e", "hub_ts": "t", "rseq": 1})


def test_additive_guard():
    old = {"A.x": "number", "A.kind": '"a" | "b"', "A.opt": "string?"}
    assert codegen.additive_violations(old, {**old, "A.new": "string?"}) == []
    assert codegen.additive_violations(old, {**old, "A.kind": '"a" | "b" | "c"'}) == []
    assert codegen.additive_violations(old, {"A.x": "number", "A.opt": "string?"}) == ["removed: A.kind (\"a\" | \"b\")"]
    assert codegen.additive_violations(old, {**old, "A.x": "string"})[0].startswith("retyped: A.x")
    assert codegen.additive_violations(old, {**old, "A.opt": "string"})[0].startswith("retyped: A.opt")
    assert codegen.additive_violations(old, {**old, "A.kind": '"a"'})[0].startswith("retyped: A.kind")


def test_ts_contains_live_message_union():
    ts = codegen.TS_PATH.read_text()
    assert "export type LiveMessage = Hello | Snapshot | LiveMachineState" in ts
    assert "export interface SseEventMap" in ts
