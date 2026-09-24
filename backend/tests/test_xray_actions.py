"""X-ray component flow: prepare -> confirm -> the same drafted record the agent path produces,
tagged with the component and the twin view it was raised from."""

import time

import pytest

from copilot.agent.llm import FakeLLM, FakeStep
from tests.conftest import FakeSimHTTP, machine

NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
VIEW = {"kind": "xray", "machine_id": "EXC001", "shown_on": "EXC001", "component": "hydraulic_pump"}


@pytest.fixture
async def srv(hub_server_factory):
    llm = FakeLLM([])
    async with hub_server_factory(llm=llm, llm_first_token_s=0.3, llm_total_s=2.0) as s:
        s.llm = llm
        s.app.state.sim = FakeSimHTTP()
        s.hub.publish_machine(machine("EXC001", ts=NOW, fault_codes=["HYD-118"]))
        yield s


async def test_prepare_does_nothing_until_confirmed(srv):
    srv.llm.script = [FakeStep(error="overloaded")]
    r = await srv.http.post("/api/actions/prepare", json={
        "tool": "create_work_order",
        "args": {"machine_id": "EXC001", "issue": "Hydraulic oil 97 C at the pump", "component": "hydraulic_pump",
                 "view": VIEW}})
    assert r.status_code == 200, r.text
    action = r.json()
    assert action["status"] == "pending" and action["tool"] == "create_work_order"
    assert "hydraulic pump" in action["summary"]
    assert action["preview"]["component"] == "hydraulic_pump"
    # Prepared, not executed.
    assert (await srv.http.get("/api/work-orders")).json()["work_orders"] == []

    done = (await srv.http.post(f"/api/actions/{action['action_id']}/confirm")).json()
    assert done["status"] == "confirmed"
    wo = (await srv.http.get("/api/work-orders")).json()["work_orders"][0]
    assert wo["component"] == "hydraulic_pump"
    assert wo["source_view"] == VIEW
    # Same drafting pipeline as the agent path: LLM failed, so the grounded template filled in.
    assert wo["draft_source"] == "template (llm overloaded)"
    assert "hydraulic pump" in wo["draft"]["title"] and "HYD-118" in wo["draft"]["description"]


async def test_incident_carries_component_and_view(srv):
    srv.llm.script = [FakeStep(error="unavailable")]
    view = {**VIEW, "component": "undercarriage"}
    r = await srv.http.post("/api/actions/prepare", json={
        "tool": "create_incident",
        "args": {"machine_id": "EXC001", "summary": "Track slipped on the wet ramp", "component": "undercarriage",
                 "view": view}})
    assert r.status_code == 200, r.text
    action_id = r.json()["action_id"]
    assert (await srv.http.post(f"/api/actions/{action_id}/confirm")).json()["status"] == "confirmed"
    inc = (await srv.http.get("/api/incidents")).json()["incidents"][0]
    assert inc["component"] == "undercarriage" and inc["source_view"] == view
    assert inc["facts"]["component"] == "undercarriage"


async def test_prepare_rejects_bad_input(srv):
    bad_tool = await srv.http.post("/api/actions/prepare", json={"tool": "book_training", "args": {}})
    assert bad_tool.status_code == 422
    bad_component = await srv.http.post("/api/actions/prepare", json={
        "tool": "create_work_order", "args": {"machine_id": "EXC001", "issue": "x y z", "component": "Pump; DROP"}})
    assert bad_component.status_code == 422
    unknown_machine = await srv.http.post("/api/actions/prepare", json={
        "tool": "create_work_order", "args": {"machine_id": "EXC999", "issue": "noise"}})
    assert unknown_machine.status_code == 422
