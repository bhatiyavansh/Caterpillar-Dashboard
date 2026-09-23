"""Live smoke: one real question per surface against the real LLM (network). Deselected by default.

    make live-smoke          # needs ANTHROPIC_API_KEY (or an `ant auth login` profile)

It FAILS (never skips) when no credentials are available, so a green run always means the real
model answered.
"""

import time

import pytest

from copilot.agent.openai_compat import build_llm
from tests.conftest import FakeSimHTTP, machine

pytestmark = pytest.mark.live
NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

QUESTIONS = {
    "cab": ("Is my seatbelt fastened and how much fuel do I have?", "EXC001"),
    "command": ("Give me a one-line status of EXC001 and EXC002.", None),
    "owner": ("Which machine has an idling anomaly?", None),
    "training": ("Which training module should OP1001 take on slopes? Just name it.", None),
    "ar": ("What is the service outlook for EXC001's hydraulic pump?", "EXC001"),
}


@pytest.mark.parametrize("surface", list(QUESTIONS))
async def test_live_question_per_surface(hub_server_factory, surface):
    from copilot.config import load_dotenv

    load_dotenv()
    llm = build_llm()
    if not llm.available:
        pytest.fail("no GROQ_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY: live smoke cannot run")
    async with hub_server_factory(llm=llm) as srv:
        srv.app.state.sim = FakeSimHTTP()
        srv.hub.publish_machine(machine("EXC001", ts=NOW, fuel_level_pct=84.4, seatbelt="fastened"))
        srv.hub.publish_machine(machine("EXC002", ts=NOW, operator_id="OP1002", idle_min=50.0))
        question, mid = QUESTIONS[surface]
        t0 = time.monotonic()
        r = await srv.http.post("/api/assistant", json={"surface": surface, "message": question, "machine_id": mid},
                                headers={"Accept": "application/json"}, timeout=30)
        body = r.json()
        errors = [e for e in body["events"] if e["event"] == "error"]
        print(f"\n[{surface}] {time.monotonic() - t0:.1f}s mode={body['mode']} provider={llm.last_used}"
              f"\n  Q: {question}\n  A: {body['text']}")
        assert body["mode"] == "live" and not errors, errors
        assert body["text"] and body["grounded"] is True
