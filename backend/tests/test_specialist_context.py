"""Specialist-aware RAG: context per specialist, evidence retrieved by code, training verdicts from sensors."""

import json
import time

import pytest

from copilot.agent import grounding
from copilot.agent.llm import FakeLLM, FakeStep
from tests.conftest import FakeSimHTTP, event, machine

NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

LESSON = {
    "route": "/training/lesson",
    "training": {
        "lesson_active": True, "phase": "retrying", "module_id": "slew", "module_title": "Slewing the upper structure",
        "skill": "swinging", "module_index": 2, "module_count": 5, "step_id": "slew-left",
        "step_instruction": "Slew the upper structure to the left.", "real_control": "Left joystick, left",
        "keys": ["Shift", "ArrowLeft"], "step_index": 0, "step_count": 3, "attempt": 2,
        "last_failure_reason": "The machine travelled instead of slewing: hold Shift while pressing the arrow.",
        "coach_line": "Hold Shift and press the left arrow to slew.", "steps_passed": 4,
        "learner": {"name": "Priya", "level": "novice", "weakest_skill": "swinging"},
        "machine_source": "lesson_sim",
        "telemetry": {"speed_kmh": 3.7, "heading_deg": 12, "swing_deg": -4, "boom_deg": 20,
                      "nearest_person_m": 7.4, "activity": "travelling", "emergency_stopped": False},
        "alerts": [{"kind": "proximity", "severity": "warning", "title": "Person near the machine",
                    "message": "Worker 7.4 m from the excavator"}],
        "recent_events": [{"time": "10:42:15", "text": "Worker entered amber zone", "severity": "warning"}],
    },
}


def _system_text(call) -> str:
    return "\n".join(b["text"] for b in call["system"])


def _live(call) -> dict:
    block = call["system"][1]["text"]
    return json.loads(block.split("\n", 1)[1])


@pytest.fixture
async def srv(hub_server_factory):
    llm = FakeLLM([])
    async with hub_server_factory(llm=llm, router="default", llm_first_token_s=0.5, llm_total_s=3.0) as s:
        s.llm = llm
        s.app.state.sim = FakeSimHTTP()
        s.hub.publish_machine(machine("EXC001", ts=NOW, seatbelt="unfastened"))
        yield s


async def _ask(srv, message, surface="training", context=None, machine_id=None):
    body = {"surface": surface, "message": message}
    if context is not None:
        body["context"] = context
    if machine_id:
        body["machine_id"] = machine_id
    r = await srv.http.post("/api/assistant", json=body, headers={"Accept": "application/json"})
    assert r.status_code == 200, r.text
    return r.json()


def _specialist(body):
    return next(e["data"] for e in body["events"] if e["event"] == "specialist")


async def test_trainee_question_goes_to_the_instructor_with_evidence_and_lesson_context(srv):
    srv.llm.script = [FakeStep(text="Check the machine all the way round before you start, then test each control.")]
    body = await _ask(srv, "What should I check before starting?", context=LESSON)
    assert _specialist(body)["id"] == "training" and _specialist(body)["routed_by"] == "rules"
    calls = [e["data"] for e in body["events"] if e["event"] == "tool_call"]
    assert calls[0]["name"] == "search_manual" and calls[0]["call_id"] == "evidence_0"  # retrieved by code
    live = _live(srv.llm.calls[0])
    assert live["training"]["step_id"] == "slew-left" and live["training"]["phase"] == "retrying"
    assert "never the assistant" in live["training"]["verdicts_from"]
    assert live["evidence"] and live["evidence"][0]["citation"].startswith("Synthetic demo knowledge: Pre-start")
    assert any(c.get("synthetic") for c in body["citations"])
    assert "synthetic" in _system_text(srv.llm.calls[0]).lower()


async def test_lesson_numbers_are_grounded_and_invented_ones_are_not(srv):
    srv.llm.script = [FakeStep(text="The worker is 7.4 m away and you were travelling at 3.7 km/h.")]
    body = await _ask(srv, "What is happening right now?", context=LESSON)
    assert body["grounded"] and "7.4 m" in body["text"]

    srv.llm.script = [FakeStep(text="The worker is 2.9 m away."), FakeStep(text="The worker is 1.1 m away.")]
    body = await _ask(srv, "What is happening right now?", context=LESSON)
    assert "2.9" not in body["text"] and "1.1" not in body["text"]  # deterministic data-only answer instead


async def test_the_assistant_cannot_certify_a_lesson_step(srv):
    srv.llm.script = [FakeStep(text="Well done, you've passed this step."),
                      FakeStep(text="Nice work, you have completed the step.")]
    body = await _ask(srv, "Did I do it right?", context=LESSON)
    assert "passed this step" not in body["text"] and "completed the step" not in body["text"]
    correction = srv.llm.calls[1]["messages"][-1]["content"]
    assert "sensors" in correction and "phase=retrying" in correction


def test_a_pass_claim_is_fine_when_the_validator_said_so():
    passed = {**LESSON["training"], "phase": "passed"}
    assert grounding.training_claims("You've passed this step.", passed) == []
    assert grounding.training_claims("You've passed this step.", LESSON["training"])
    assert grounding.training_claims("You've passed this step.", None) == []


async def test_why_cant_i_move_uses_live_alerts_and_the_protocol_verbatim(srv):
    srv.hub.publish_event(event("evt_900001", "seatbelt_unfastened", severity="high",
                                message="Seatbelt unfastened: travel locked", data={"escalation_level": 3}))
    srv.llm.script = [FakeStep(tool_calls=[("get_protocol", {"event": "seatbelt_unfastened"})]),
                      FakeStep(text="Travel is locked because your seatbelt is unfastened.")]
    body = await _ask(srv, "Why can't I move?", surface="cab", machine_id="EXC001")
    assert _specialist(body)["id"] == "operations"
    live = _live(srv.llm.calls[0])
    assert live["my_machine"]["seatbelt"] == "unfastened"
    assert any(e["event"] == "seatbelt_unfastened" for e in live["recent_safety_events"])
    for i, step in enumerate(srv.app.state.protocols.by_id["PRT-SEATBELT"].steps, 1):
        assert f"{i}. {step}" in body["text"]  # appended by code, not written by the model
        assert body["text"].count(step) == 1
    q = next(e["data"]["args"]["query"] for e in body["events"] if e["event"] == "tool_call"
             and e["data"]["call_id"] == "evidence_0")
    assert "seatbelt unfastened" in q  # the open alert steers the evidence


async def test_training_answer_without_an_llm_is_built_from_the_evidence(hub_server_factory):
    async with hub_server_factory(llm=FakeLLM(available=False), router="default") as srv:
        body = await _ask(srv, "What should I check before starting?", context=LESSON)
        assert body["mode"] == "fallback"
        assert "Synthetic demo knowledge: Pre-start inspection" in body["text"]
        assert body["citations"] and body["citations"][0]["synthetic"] is True


async def test_safety_on_the_training_surface_stays_deterministic(hub_server_factory):
    async with hub_server_factory(llm=FakeLLM(available=False), router="default") as srv:
        body = await _ask(srv, "My seatbelt is unfastened, what do I do?", context=LESSON)
        assert _specialist(body)["id"] == "safety"
        for step in srv.app.state.protocols.by_id["PRT-SEATBELT"].steps:
            assert step in body["text"] and step in body["speak_text"]


async def test_search_uses_the_asking_specialists_profile(srv):
    srv.llm.script = [FakeStep(text="HYD-118 means the hydraulic oil is too hot.")]
    body = await _ask(srv, "What does fault code HYD-118 mean?", surface="cab", machine_id="EXC001")
    assert _specialist(body)["id"] == "maintenance"
    res = next(e["data"] for e in body["events"] if e["event"] == "tool_result" and e["data"]["name"] == "search_manual")
    assert res["ok"]
    ev = _live(srv.llm.calls[0])["evidence"]
    assert ev[0]["citation"] == "Demo site manual (CAT Copilot hackathon), p. 2"  # exact fault-code hit still leads


async def test_context_is_validated_and_bounded(srv):
    too_many_keys = {"training": {**LESSON["training"], "keys": ["a"] * 7}}
    r = await srv.http.post("/api/assistant", json={"surface": "training", "message": "hi", "context": too_many_keys},
                            headers={"Accept": "application/json"})
    assert r.status_code == 422
    r = await srv.http.post("/api/assistant", json={"surface": "training", "message": "hi",
                                                    "context": {"route": "/x", "verdict": "passed"}},
                            headers={"Accept": "application/json"})
    assert r.status_code == 422  # unknown fields are refused, not silently accepted


def test_only_vague_follow_ups_borrow_the_screen_context_for_retrieval():
    from copilot.agent.context import is_follow_up, retrieval_query
    from copilot.contracts.assistant import AssistantRequest

    assert not is_follow_up("What should I check before starting?")
    for q in ("Why is that important?", "What did I do wrong?", "Explain that differently", "What should I do next?"):
        assert is_follow_up(q), q
    ctx = {"training": LESSON["training"]}
    req = AssistantRequest(surface="training", message="What did I do wrong?")
    q = retrieval_query(req, "training", ctx)
    assert q.startswith("What did I do wrong?") and "Slewing the upper structure" in q and "hold Shift" in q
    plain = AssistantRequest(surface="training", message="What should I check before starting?")
    assert retrieval_query(plain, "training", ctx) == "What should I check before starting?"
    # "that" is the previous question's subject, not the lesson step
    why = AssistantRequest(surface="training", message="Why is that important?")
    q = retrieval_query(why, "training", ctx, previous="What should I check before starting?")
    assert "check before starting" in q and "Slewing" not in q
    # a warning question is about the alert that is open, not the step
    warn = AssistantRequest(surface="training", message="Why did that warning appear?")
    q = retrieval_query(warn, "training", ctx, previous="What should I check before starting?")
    assert "Person near the machine" in q and "check before starting" not in q
    # with no previous question, a vague follow-up is about the current step
    assert "Slew the upper structure" in retrieval_query(why, "training", ctx)
    # in a lesson, "what next" is about the step, whatever was asked before
    nxt = AssistantRequest(surface="training", message="What should I do next?")
    q = retrieval_query(nxt, "training", ctx, previous="What should I check before starting?")
    assert "Slew the upper structure" in q and "check before starting" not in q


def test_the_models_own_copy_of_protocol_steps_is_dropped_so_steps_appear_once():
    from copilot.agent.loop import strip_restated_steps

    p = {"id": "PRT-SEATBELT", "steps": ["Bring the machine to a controlled stop.", "Fasten the seatbelt."]}
    text = ("You can't move because the seatbelt is unfastened.\n**Protocol PRT-SEATBELT** says:\n"
            "1. Bring the machine to a controlled stop.\n2. **Fasten the seatbelt.**")
    assert strip_restated_steps(text, p) == "You can't move because the seatbelt is unfastened."
    assert strip_restated_steps("1. Fasten the seatbelt.", p) == "Follow the site protocol for this alert."


def test_speech_never_reads_markdown_aloud():
    from copilot.agent.loop import speak

    assert speak("**Stop** the machine.\n## Then `fasten` the belt. Third.", "cab") == "Stop the machine. Then fasten the belt."


async def test_asking_to_confirm_without_calling_the_tool_is_sent_back_to_act(srv):
    srv.llm.script = [
        FakeStep(text="Do you want me to file an incident for EXC001? Please confirm."),
        FakeStep(tool_calls=[("create_incident", {"machine_id": "EXC001", "summary": "a worker walked behind the machine"})]),
        FakeStep(text="I have prepared the incident report for EXC001. Tap Confirm to file it."),
    ]
    body = await _ask(srv, "File an incident for EXC001: a worker walked behind the machine", surface="cab",
                      machine_id="EXC001")
    assert body["actions"] and body["actions"][0]["tool"] == "create_incident"  # a real pending action exists
    assert "no action is pending" in srv.llm.calls[1]["messages"][-1]["content"]


async def test_a_confirm_request_with_nothing_pending_is_labelled(srv):
    srv.llm.script = [FakeStep(text="Shall I book that? Please confirm."),
                      FakeStep(text="Should I go ahead? Please confirm.")]
    body = await _ask(srv, "Book me on slope safety", surface="training", context=LESSON)
    assert not body["actions"] and "No action is pending" in body["text"]
