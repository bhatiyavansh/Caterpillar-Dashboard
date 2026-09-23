"""Phase D gate: routing accuracy, specialist tool subsets, LLM timeout fallback, verbatim safety steps."""

import asyncio
import time

import httpx
import pytest

from copilot.agent.llm import FakeLLM, FakeStep, LLMError
from copilot.agent.openai_compat import ChainLLM, OpenAICompatLLM, _to_openai
from copilot.agent.router import Router
from copilot.agent.tools.definitions import build_registry
from scripts.router_eval import evaluate, report
from tests.conftest import FakeSimHTTP, machine

NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


async def test_router_eval_rules_only_prints_confusion_table(capsys):
    res = await evaluate(FakeLLM(available=False))
    acc, p95 = report(res)
    print(capsys.readouterr().out)
    assert acc >= 0.9 and p95 < 300


async def test_ambiguous_question_uses_llm_then_times_out_to_general():
    reg = build_registry()
    picker = FakeLLM([FakeStep(tool_calls=[("route", {"specialist": "coordination"})])])
    r = await Router(picker, "fast", reg).route("tell me about EXC001", "command")
    assert r.id == "coordination" and r.routed_by == "llm"
    slow = FakeLLM([FakeStep(first_token_delay=5.0)])
    t0 = time.monotonic()
    r = await Router(slow, "fast", reg, llm_timeout_s=0.2).route("tell me about EXC001", "command")
    assert r.id == "general" and r.routed_by == "fallback" and r.tool_names is None
    assert time.monotonic() - t0 < 1.0


async def test_specialist_limits_tools_and_emits_sse(hub_server_factory):
    llm = FakeLLM([FakeStep(text="Here are the steps.")])
    async with hub_server_factory(llm=llm, router="default") as srv:
        srv.app.state.sim = FakeSimHTTP()
        srv.hub.publish_machine(machine("EXC001", ts=NOW))
        body = (await srv.http.post("/api/assistant", json={"surface": "cab", "message": "Seatbelt alarm, what do I do?"},
                                    headers={"Accept": "application/json"})).json()
        spec = next(e["data"] for e in body["events"] if e["event"] == "specialist")
        assert spec["id"] == "safety" and spec["routed_by"] == "rules"
        offered = set(llm.calls[0]["tools"])
        assert "get_protocol" in offered and "run_what_if" not in offered and "book_training" not in offered
        steps = srv.app.state.protocols.by_id["PRT-SEATBELT"].steps
        for i, step in enumerate(steps, 1):
            assert f"{i}. {step}" in body["text"]  # appended verbatim by code


async def test_safety_answer_is_deterministic_without_llm(hub_server_factory):
    async with hub_server_factory(llm=FakeLLM(available=False), router="default") as srv:
        body = (await srv.http.post("/api/assistant", json={"surface": "cab", "message": "Someone is behind me!"},
                                    headers={"Accept": "application/json"})).json()
        assert body["mode"] == "fallback"
        for step in srv.app.state.protocols.by_id["PRT-PROXIMITY"].steps:
            assert step in body["text"] and step in body["speak_text"]


# ---------------------------------------------------------------- Groq / Gemini adapter (mock transport)

def test_message_conversion_round_trip():
    msgs = [{"role": "user", "content": "status?"},
            {"role": "assistant", "content": [{"type": "text", "text": "checking"},
                                              {"type": "tool_use", "id": "c1", "name": "get_machine_status",
                                               "input": {"machine_id": "EXC001"}}]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "c1", "content": "{}"}]}]
    out = _to_openai([{"type": "text", "text": "sys"}], msgs)
    assert [m["role"] for m in out] == ["system", "user", "assistant", "tool"]
    assert out[2]["tool_calls"][0]["function"]["name"] == "get_machine_status"


def _llm(handler, name="groq") -> OpenAICompatLLM:
    llm = OpenAICompatLLM(name, api_key="test-key")
    llm._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return llm


async def test_openai_compat_tool_call_and_chain_fallback():
    def groq_down(req):
        return httpx.Response(503)

    def gemini_ok(req):
        assert req.headers["Authorization"] == "Bearer test-key"
        return httpx.Response(200, json={"choices": [{"message": {"content": "", "tool_calls": [
            {"id": "x1", "type": "function", "function": {"name": "get_machine_status",
                                                         "arguments": '{"machine_id": "EXC001"}'}}]}}]})

    chain = ChainLLM([_llm(groq_down, "groq"), _llm(gemini_ok, "gemini")])
    loop = asyncio.get_running_loop()
    turn = await chain.turn(model="main", system=[{"type": "text", "text": "s"}], messages=[{"role": "user", "content": "hi"}],
                            tools=[{"name": "get_machine_status", "description": "d", "input_schema": {"type": "object"}}],
                            max_tokens=100, effort=None, on_text=None, first_token_s=5, deadline=loop.time() + 5)
    assert chain.last_used == "gemini" and turn.tool_calls[0].input == {"machine_id": "EXC001"}


async def test_rate_limit_maps_to_llm_error():
    llm = _llm(lambda req: httpx.Response(429))
    with pytest.raises(LLMError) as exc:
        await llm.turn(model="fast", system=[{"type": "text", "text": "s"}], messages=[{"role": "user", "content": "x"}],
                       tools=[], max_tokens=10, effort=None, on_text=None, first_token_s=1,
                       deadline=asyncio.get_running_loop().time() + 2)
    assert exc.value.code == "rate_limited"
