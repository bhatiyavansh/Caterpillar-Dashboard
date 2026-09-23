"""Phase B gate: FakeLLM tests for every tool and every confirm path, timeouts, fallbacks, grounding."""

import asyncio
import json
import time

import pytest

from copilot.agent.llm import FakeLLM, FakeStep
from copilot.ml.auto import AutoML
from copilot.ml.port import MLUnavailable
from tests.conftest import FakeSimHTTP, event, machine

NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def parse_sse(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


async def ask(srv, message, surface="command", **kw):
    r = await srv.http.post("/api/assistant", json={"surface": surface, "message": message, **kw})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    return parse_sse(r.text)


def final(events):
    return next(p for n, p in events if n == "final")


def names(events):
    return [n for n, _ in events]


@pytest.fixture
async def agent_srv(hub_server_factory):
    """Hub with FakeLLM (script set per test), FakeML, FakeSimHTTP and live machines EXC001/EXC002."""
    llm = FakeLLM([])
    async with hub_server_factory(llm=llm, llm_first_token_s=0.3, llm_total_s=2.0) as srv:
        srv.llm = llm
        srv.app.state.sim = FakeSimHTTP()
        srv.hub.publish_machine(machine("EXC001", ts=NOW, fuel_level_pct=84.4, seatbelt="fastened"))
        srv.hub.publish_machine(machine("EXC002", ts=NOW, operator_id="OP1002", idle_min=50.0))
        yield srv


# --------------------------------------------------------------------------- every tool

READ_TOOLS = [
    ("get_machine_status", {"machine_id": "EXC001"}, "command", "EXC001 fuel is 84.4%."),
    ("get_fleet_overview", {}, "command", "2 machines are live."),
    ("get_shift_tasks", {"operator_id": "OP1001"}, "cab", "Your first task is T-0001."),
    ("predict_task_time", {"task_id": "T-0001"}, "cab", "About 200 minutes (170-250)."),
    ("get_anomalies", {"machine_id": "EXC002"}, "owner", "EXC002 idled; fuel cost 450 rupees."),
    ("get_maintenance_forecast", {"machine_id": "EXC001"}, "owner", "Hydraulic pump service in 1315 h."),
    ("get_recent_events", {"minutes": 30}, "command", "No major events."),
    ("get_shift_summary", {"hours": 8}, "command", "Quiet shift so far."),
    ("run_what_if", {"trucks": 6, "weather": "rain"}, "command", "Throughput -11%."),
]


@pytest.mark.parametrize(("tool", "args", "surface", "answer"), READ_TOOLS)
async def test_every_read_tool(agent_srv, tool, args, surface, answer):
    agent_srv.llm.script = [FakeStep(tool_calls=[(tool, args)]), FakeStep(text=answer)]
    ev = await ask(agent_srv, f"use {tool}", surface=surface, machine_id="EXC001")
    result = next(p for n, p in ev if n == "tool_result")
    assert result["name"] == tool and result["ok"], result
    assert result["provenance"]
    f = final(ev)
    assert f["text"] == answer and f["grounded"] is True, f
    assert names(ev)[0] == "meta" and names(ev)[-2:] == ["final", "done"]


async def test_search_manual_is_honest_before_phase_c(agent_srv):
    agent_srv.app.state.extras.pop("rag", None)
    agent_srv.llm.script = [FakeStep(tool_calls=[("search_manual", {"query": "HYD-118"})]),
                            FakeStep(text="The manual index is not available yet.")]
    ev = await ask(agent_srv, "what is HYD-118")
    res = next(p for n, p in ev if n == "tool_result")
    assert res["ok"] is False and res["provenance"] == "stub"


# --------------------------------------------------------------------------- confirm paths

CONFIRM_TOOLS = [
    ("reorder_tasks", {"operator_id": "OP1001", "reason": "rain"}, "task_reordered_via_sim"),
    ("create_incident", {"machine_id": "EXC001", "summary": "Worker entered the rear blind spot"}, "incident_created"),
    ("create_work_order", {"machine_id": "EXC001", "issue": "Hydraulic oil hot"}, "work_order_created"),
    ("book_training", {"operator_id": "OP1001", "module": "Slope and bench safety"}, "training_booked"),
]


def _effects(srv):
    sim = [c for c in srv.app.state.sim.calls if c[0] == "reorder"]
    kinds = [e.get("event") for e in srv.hub.ring if e.get("type") == "event"]
    return sim, kinds


@pytest.mark.parametrize(("tool", "args", "effect"), CONFIRM_TOOLS)
async def test_confirm_tool_does_nothing_until_confirmed_then_once(agent_srv, tool, args, effect):
    # third step: the report drafter's LLM call on confirm (incidents/work orders) -> labelled template path
    agent_srv.llm.script = [FakeStep(tool_calls=[(tool, args)]), FakeStep(text="Please confirm."),
                            FakeStep(error="unavailable")]
    ev = await ask(agent_srv, "do it", surface="command")
    req = next(p for n, p in ev if n == "confirm_required")
    assert final(ev)["actions"][0]["action_id"] == req["action_id"]
    sim, kinds = _effects(agent_srv)
    assert sim == [] and effect not in kinds and "action_pending" in kinds  # nothing happened yet

    r1 = await agent_srv.http.post(f"/api/actions/{req['action_id']}/confirm")
    r2 = await agent_srv.http.post(f"/api/actions/{req['action_id']}/confirm")  # double tap
    assert r1.status_code == 200 and r1.json()["status"] == "confirmed"
    assert r2.status_code == 200 and r2.json() == r1.json()  # idempotent
    sim, kinds = _effects(agent_srv)
    if effect == "task_reordered_via_sim":
        assert sim == [("reorder", "OP1001", "rain")]  # the sim emits task_reordered itself
    else:
        assert kinds.count(effect) == 1
    assert kinds.count("action_confirmed") == 1


async def test_cancel_expire_supersede_unknown(agent_srv):
    wo = ("create_work_order", {"machine_id": "EXC001", "issue": "Track tension"})
    agent_srv.llm.script = [FakeStep(tool_calls=[wo]), FakeStep(text="Confirm?"),
                            FakeStep(tool_calls=[wo]), FakeStep(text="Confirm?"),
                            FakeStep(tool_calls=[wo]), FakeStep(text="Confirm?")]
    a1 = next(p for n, p in await ask(agent_srv, "wo") if n == "confirm_required")["action_id"]
    r = await agent_srv.http.post(f"/api/actions/{a1}/cancel")
    assert r.json()["status"] == "cancelled"
    assert (await agent_srv.http.post(f"/api/actions/{a1}/confirm")).status_code == 409
    a2 = next(p for n, p in await ask(agent_srv, "wo") if n == "confirm_required")["action_id"]
    a3 = next(p for n, p in await ask(agent_srv, "wo") if n == "confirm_required")["action_id"]
    assert (await agent_srv.http.post(f"/api/actions/{a2}/confirm")).status_code == 409  # superseded by a3
    agent_srv.app.state.actions.actions[a3].expires_mono = 0  # simulate 2 minutes passing
    assert (await agent_srv.http.post(f"/api/actions/{a3}/confirm")).status_code == 410
    assert (await agent_srv.http.post("/api/actions/ACT-nope/confirm")).status_code == 404
    kinds = [e.get("event") for e in agent_srv.hub.ring if e.get("type") == "event"]
    assert "work_order_created" not in kinds and kinds.count("action_cancelled") == 1
    assert agent_srv.app.state.actions.expiry_s == 120.0


async def test_confirm_failure_is_reported_not_silent(agent_srv):
    class DownSim(FakeSimHTTP):
        async def reorder_tasks(self, operator_id, reason):
            from copilot.sim_client import SimUnavailable

            raise SimUnavailable("sim down")

    agent_srv.app.state.sim = DownSim()
    agent_srv.llm.script = [FakeStep(tool_calls=[("reorder_tasks", {"operator_id": "OP1001", "reason": "rain"})]),
                            FakeStep(text="Confirm?")]
    aid = next(p for n, p in await ask(agent_srv, "reorder") if n == "confirm_required")["action_id"]
    r = await agent_srv.http.post(f"/api/actions/{aid}/confirm")
    assert r.status_code == 502 and "sim down" in r.text  # downstream failure surfaces as Bad Gateway
    listed = (await agent_srv.http.get("/api/actions")).json()["actions"]
    assert next(a for a in listed if a["action_id"] == aid)["status"] == "failed"
    assert "action_failed" in [e.get("event") for e in agent_srv.hub.ring]


# --------------------------------------------------------------------------- loop behaviour


async def test_parallel_tool_calls_return_in_one_user_message(agent_srv):
    agent_srv.llm.script = [
        FakeStep(tool_calls=[("get_machine_status", {"machine_id": "EXC001"}),
                             ("get_machine_status", {"machine_id": "EXC002"})]),
        FakeStep(text="Both are reporting."),
    ]
    await ask(agent_srv, "compare")
    second = agent_srv.llm.calls[1]["messages"][-1]
    assert second["role"] == "user" and [b["type"] for b in second["content"]] == ["tool_result", "tool_result"]


async def test_surface_allow_list(agent_srv):
    agent_srv.llm.script = [FakeStep(tool_calls=[("run_what_if", {"trucks": 5})]), FakeStep(text="Not here.")]
    ev = await ask(agent_srv, "what if", surface="cab", machine_id="EXC001")
    assert "run_what_if" not in agent_srv.llm.calls[0]["tools"]  # never offered on the cab
    res = next(p for n, p in ev if n == "tool_result")
    assert res["ok"] is False and res["summary"] == "not allowed on this surface"
    told_model = agent_srv.llm.calls[1]["messages"][-1]["content"][0]["content"]
    assert "not available on the cab surface" in told_model


async def test_invalid_tool_input_is_rejected_before_the_handler(agent_srv):
    agent_srv.llm.script = [FakeStep(tool_calls=[("get_machine_status", {"machine_id": "excavator one"})]),
                            FakeStep(text="I need a machine id.")]
    ev = await ask(agent_srv, "status")
    assert next(p for n, p in ev if n == "tool_result")["summary"] == "invalid tool input"


async def test_max_five_rounds(agent_srv):
    agent_srv.llm.script = [FakeStep(tool_calls=[("get_recent_events", {})]) for _ in range(6)]
    ev = await ask(agent_srv, "loop forever")
    assert len(agent_srv.llm.calls) == 5
    assert names(ev).count("tool_result") == 5 and final(ev)["text"]


async def test_first_token_timeout_falls_back_to_data(agent_srv):
    agent_srv.llm.script = [FakeStep(text="late", first_token_delay=5.0)]
    t0 = time.monotonic()
    ev = await ask(agent_srv, "status of EXC001")
    assert time.monotonic() - t0 < 1.5
    err = next(p for n, p in ev if n == "error")
    assert err["code"] == "first_token_timeout" and err["fallback_used"] is True
    f = final(ev)
    assert "EXC001" in f["text"] and "84.4" in f["text"]  # answered from live data by rule tools


async def test_total_timeout_falls_back(agent_srv):
    agent_srv.llm.script = [FakeStep(tool_calls=[("get_machine_status", {"machine_id": "EXC001"})]),
                            FakeStep(text="slow", delay=5.0)]
    t0 = time.monotonic()
    ev = await ask(agent_srv, "status of EXC001")
    assert time.monotonic() - t0 < 3.0  # llm_total_s=2.0
    assert next(p for n, p in ev if n == "error")["code"] == "total_timeout"
    assert "84.4" in final(ev)["text"]  # built from the tool result already fetched


@pytest.mark.parametrize("code", ["overloaded", "rate_limited", "refusal", "unavailable"])
async def test_llm_errors_fall_back(agent_srv, code):
    agent_srv.llm.script = [FakeStep(error=code)]
    ev = await ask(agent_srv, "status of EXC002")
    assert next(p for n, p in ev if n == "error")["code"] == code
    assert "EXC002" in final(ev)["text"]


async def test_no_llm_configured_uses_rule_tools(hub_server_factory):
    async with hub_server_factory(llm=FakeLLM(available=False)) as srv:
        srv.hub.publish_machine(machine("EXC001", ts=NOW, fuel_level_pct=84.4))
        ev = await ask(srv, "how is EXC001 doing?")
        meta = ev[0][1]
        assert meta["mode"] == "fallback" and meta["model"] is None
        assert next(p for n, p in ev if n == "error")["code"] == "llm_unavailable"
        assert "84.4" in final(ev)["text"]
        health = (await srv.http.get("/api/health")).json()
        assert health["llm"]["available"] is False


# --------------------------------------------------------------------------- grounding


async def test_grounding_rejects_invented_numbers_then_corrects(agent_srv):
    agent_srv.llm.script = [
        FakeStep(tool_calls=[("get_machine_status", {"machine_id": "EXC001"})]),
        FakeStep(text="EXC001 has 37% fuel and 4.2 hours left."),  # invented
        FakeStep(text="EXC001 has 84.4% fuel."),  # corrected after the system note
    ]
    ev = await ask(agent_srv, "fuel?")
    correction = agent_srv.llm.calls[2]["messages"][-1]["content"]
    assert "37" in correction and "4.2" in correction
    assert final(ev)["text"] == "EXC001 has 84.4% fuel." and final(ev)["grounded"] is True


async def test_grounding_twice_failed_uses_deterministic_answer(agent_srv):
    agent_srv.llm.script = [
        FakeStep(tool_calls=[("get_machine_status", {"machine_id": "EXC001"})]),
        FakeStep(text="Fuel is 37%."),
        FakeStep(text="Fuel is 36%."),
    ]
    ev = await ask(agent_srv, "fuel?")
    f = final(ev)
    assert "37" not in f["text"] and "36" not in f["text"] and "84.4" in f["text"]
    log = [json.loads(x) for x in (agent_srv.app.state.settings.log_dir / "turns.jsonl").read_text().splitlines()]
    assert log[-1]["llm_grounded"] is False and log[-1]["grounding"]["problems"] == ["36"]


def test_grounding_unit_rules():
    from copilot.agent.grounding import check

    src = [{"p50": 234.8, "progress": 0.62, "machine_id": "EXC001", "idle_min": 130}]
    assert check("About 235 minutes, 62% done on EXC001.", src).grounded
    assert check("That is 2 h 10 min of idling.", src).grounded  # 130 min -> 2 h (small int) + 10
    assert not check("DOZ001 is at 81%.", src).grounded
    assert not check("About 234.2 minutes.", src).grounded  # precision matters: 234.8 does not round to 234.2
    assert check("About 234.8 minutes.", src).grounded
    assert check("It's the 3rd task.", src).grounded  # small integers allowed


# --------------------------------------------------------------------------- REST + ML port


async def test_json_mode_and_rest_endpoints(agent_srv):
    agent_srv.llm.script = [FakeStep(text="Hello.")]
    r = await agent_srv.http.post("/api/assistant", json={"surface": "owner", "message": "hi"},
                                  headers={"Accept": "application/json"})
    assert r.json()["text"] == "Hello." and r.json()["mode"] == "live"
    r = await agent_srv.http.post("/api/tasks/estimate", json={"task_id": "T-0001"})
    assert r.status_code == 200 and r.json()["data"]["estimate_total_min"]["p50"] == 200.0
    r = await agent_srv.http.get("/api/anomalies", params={"machine_id": "EXC002"})
    assert r.json()["provenance"] == "fake" and r.json()["data"]["total"] == 1
    job = (await agent_srv.http.post("/api/whatif", json={"trucks": 5})).json()
    await asyncio.sleep(0.2)
    got = (await agent_srv.http.get(f"/api/whatif/{job['job_id']}")).json()
    assert got["status"] == "done" and got["result"]["delta"]["throughput_m3"] == "-11%"
    again = (await agent_srv.http.post("/api/whatif", json={"trucks": 5})).json()
    assert again["cached"] is True  # disk cache by params
    assert (await agent_srv.http.post("/api/assistant", json={"surface": "moon", "message": "x"})).status_code == 422


async def test_ml_auto_switch_and_labelled_fallback(monkeypatch):
    stub = AutoML("stub")
    assert stub.name == "stub"
    est = await stub.estimate_task({"estimated_time_min": 100.0})
    assert est["provenance"] == "stub" and est["p50"] == 100.0
    with pytest.raises(MLUnavailable):
        await stub.what_if({})

    class Broken:
        async def estimate_task(self, f):
            raise MLUnavailable("libomp missing")

    auto = AutoML("stub")
    auto.real = Broken()
    auto._probed = time.monotonic()
    out = await auto.estimate_task({"estimated_time_min": 50.0})
    assert out["provenance"].startswith("stub (real failed: libomp missing")


# --------------------------------------------------------------------------- updates / recall
#
# These exercise the tool handlers through the registry rather than the SSE stream: the
# `tool_result` event carries only ok/summary/provenance by contract, so the data a tool hands
# the model is only inspectable here.


async def call_tool(srv, name: str, args: dict, surface: str = "command", machine_id: str | None = None):
    from copilot.contracts.assistant import AssistantRequest

    ctx = srv.app.state.context_factory(
        AssistantRequest(surface=surface, message="(test)", machine_id=machine_id))
    res, _ms = await srv.app.state.registry.call(name, args, ctx)
    return res


async def test_shift_summary_counts_events_and_lists_what_is_open(agent_srv):
    """The "catch me up" tool: counts by severity/type/machine, notable events, still-open alerts."""
    for i, (kind, sev) in enumerate([("proximity_alert", "high"), ("proximity_alert", "high"),
                                     ("seatbelt_unfastened", "high"), ("weather_change", "info")]):
        agent_srv.hub.publish_event(event(f"e{i}", kind=kind, severity=sev))
    await agent_srv.hub.persister.flush()

    res = await call_tool(agent_srv, "get_shift_summary", {"hours": 8})
    assert res.ok, res
    d = res.data
    assert d["total_events"] == 4, d
    assert d["by_severity"] == {"high": 3, "info": 1}, d["by_severity"]
    assert d["by_type"]["proximity_alert"] == 2, d["by_type"]
    assert d["by_machine"]["EXC001"] == 4, d["by_machine"]
    assert d["quiet"] is False
    # Only high/critical are promoted to "notable"; the weather change is counted, not promoted.
    assert {e["event"] for e in d["notable_events"]} == {"proximity_alert", "seatbelt_unfastened"}
    # The proximity/seatbelt events are still inside their TTL, so they are open right now.
    assert d["open_now"], d["open_now"]


async def test_shift_summary_says_quiet_rather_than_inventing(agent_srv):
    res = await call_tool(agent_srv, "get_shift_summary", {"hours": 1}, surface="cab")
    assert res.ok, res
    assert res.data["quiet"] is True and res.data["total_events"] == 0
    assert res.data["notable_events"] == [] and res.data["open_now"] == []


async def test_shift_summary_suppresses_the_one_minute_forest_noise(agent_srv):
    """REPO_ANALYSIS C12: 60 s-window unusual_pattern anomalies misfire and must never be counted."""
    agent_srv.hub.publish_event(event("n1", kind="anomaly_detected", severity="medium",
                                      data={"anomaly_type": "unusual_pattern", "window_min": 1}))
    agent_srv.hub.publish_event(event("r1", kind="anomaly_detected", severity="medium",
                                      data={"anomaly_type": "unusual_pattern", "window_min": 60}))
    await agent_srv.hub.persister.flush()

    res = await call_tool(agent_srv, "get_shift_summary", {"hours": 8})
    assert res.data["total_events"] == 1, res.data["by_type"]


@pytest.fixture
async def history_srv(hub_server_factory):
    """The state persister throttles to one row per machine per `persist_state_interval_s`;
    set it to 0 so a burst of readings in one test actually lands in the table."""
    llm = FakeLLM([])
    async with hub_server_factory(llm=llm, persist_state_interval_s=0.0) as srv:
        srv.llm = llm
        srv.app.state.sim = FakeSimHTTP()
        yield srv


async def test_machine_history_trends_only_channels_the_contract_carries(history_srv):
    """Trends are computed, never invented: a channel with no readings is simply absent."""
    for i, temp in enumerate([70.0, 80.0, 95.0]):
        history_srv.hub.publish_machine(machine("EXC001", ts=NOW, hydraulic_temp_c=temp,
                                                fuel_level_pct=90.0 - i, fuel_used_l=float(i * 5)))
    await history_srv.hub.persister.flush()

    res = await call_tool(history_srv, "get_machine_history", {"machine_id": "EXC001", "hours": 1})
    assert res.ok and res.provenance == "db", res
    t = res.data["trends"]
    assert res.data["samples"] == 3, res.data
    assert t["hydraulic_temp_c"]["first"] == 70.0 and t["hydraulic_temp_c"]["max"] == 95.0
    assert t["hydraulic_temp_c"]["change"] == 25.0
    assert t["fuel_used_l"]["change"] == 10.0  # answers "how many litres", in litres
    assert "bubble" not in t  # not numeric: absent rather than coerced


async def test_machine_history_is_honest_when_there_is_nothing_stored(agent_srv):
    """A tool that has nothing to say says so; the registry turns ToolError into ok=False."""
    res = await call_tool(agent_srv, "get_machine_history", {"machine_id": "TRK009", "hours": 1})
    assert res.ok is False, res
    assert "no stored readings" in str(res.data)
    assert "never reported" in str(res.data)  # and it distinguishes "quiet" from "unknown"
