"""Documents, site plan, verbatim protocols on model lookups, server speech-to-text, provider chain limits."""

import asyncio

import httpx
import pytest

from copilot.agent.fallback import summarize
from copilot.agent.llm import FakeLLM, FakeStep, LLMError
from copilot.agent.openai_compat import ChainLLM, OpenAICompatLLM
from tests.conftest import FakeSimHTTP, machine

NOW = "2026-09-23T10:00:00Z"


@pytest.fixture
async def srv(hub_server_factory):
    llm = FakeLLM([])
    async with hub_server_factory(llm=llm, llm_first_token_s=0.3, llm_total_s=2.0) as s:
        s.llm = llm
        s.app.state.sim = FakeSimHTTP()
        s.hub.publish_machine(machine("EXC001", ts=NOW, fuel_level_pct=84.4, seatbelt="fastened"))
        yield s


async def _call(srv, name, args, surface="cab"):
    from copilot.contracts.assistant import AssistantRequest

    ctx = srv.app.state.context_factory(AssistantRequest(surface=surface, message="(test)", machine_id="EXC001"))
    res, _ = await srv.app.state.registry.call(name, args, ctx)
    return res


async def test_list_documents_names_every_protocol_and_manual(srv):
    res = await _call(srv, "list_documents", {})
    assert res.ok
    ids = {p["protocol_id"] for p in res.data["protocols"]}
    assert {"PRT-SEATBELT", "PRT-PROXIMITY"} <= ids
    assert any(m["citation"].startswith("29 CFR 1926.651") for m in res.data["manuals"])
    assert "Seatbelt" in summarize("list_documents", res)


async def test_get_protocol_without_arguments_lists_instead_of_failing(srv):
    res = await _call(srv, "get_protocol", {})
    assert res.ok and not res.data["found"] and len(res.data["protocols"]) >= 7


async def test_site_plan_covers_every_operator(srv):
    res = await _call(srv, "get_site_plan", {})
    assert res.ok and res.data["tasks_total"] == 27
    ops = {c["operator_id"] for c in res.data["crews"]}
    assert "OP1001" in ops and len(ops) > 1
    assert summarize("get_site_plan", res).startswith("Site plan: 27 tasks")


async def test_protocol_the_model_looked_up_is_appended_verbatim(srv):
    srv.llm.script = [FakeStep(tool_calls=[("get_protocol", {"protocol_id": "PRT-SEATBELT"})]),
                      FakeStep(text="The seatbelt protocol applies.")]
    body = (await srv.http.post("/api/assistant", json={"surface": "cab", "message": "seatbelt rules?"},
                                headers={"accept": "application/json"})).json()
    assert body["text"].startswith("The seatbelt protocol applies.")
    assert "1. Bring the machine to a controlled stop and lower the attachment to the ground." in body["text"]


async def test_stt_is_503_without_a_provider_and_transcribes_with_one(srv):
    r = await srv.http.post("/api/stt", content=b"x" * 2000, headers={"content-type": "audio/webm"})
    assert r.status_code == 503

    seen = {}

    async def transcribe(**kw):
        seen.update(kw)
        return {"text": "fuel of EXC001", "language": "english"}

    srv.llm.stt_available = True
    srv.llm.transcribe = transcribe
    r = await srv.http.post("/api/stt?lang=hi-IN", content=b"x" * 2000, headers={"content-type": "audio/webm;codecs=opus"})
    assert r.status_code == 200 and r.json()["text"] == "fuel of EXC001"
    assert seen["language"] == "hi" and seen["media_type"] == "audio/webm" and seen["filename"] == "clip.webm"
    assert (await srv.http.post("/api/stt", content=b"")).status_code == 422


def test_spoken_ids_are_joined_back():
    from copilot.api.assistant import normalize_ids

    assert normalize_ids("What is the fuel level of EX C001?") == "What is the fuel level of EXC001?"
    assert normalize_ids("is t r k 0 0 2 waiting for op 1001") == "is TRK002 waiting for OP1001"
    assert normalize_ids("dozer DOZ-001 and 2026 exits") == "dozer DOZ001 and 2026 exits"


def _llm(handler, name="groq") -> OpenAICompatLLM:
    llm = OpenAICompatLLM(name, api_key="test-key")
    llm._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return llm


async def _turn(llm):
    return await llm.turn(model="main", system=[{"type": "text", "text": "s"}], messages=[{"role": "user", "content": "x"}],
                          tools=[], max_tokens=10, effort=None, on_text=None, first_token_s=1,
                          deadline=asyncio.get_running_loop().time() + 2)


async def test_rate_limit_rotates_through_the_providers_models():
    tried = []

    def handler(req):
        model = __import__("json").loads(req.content)["model"]
        tried.append(model)
        if model != "qwen/qwen3.8-27b":
            return httpx.Response(429)
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok then 【src】"}}]})

    turn = await _turn(_llm(handler))
    assert tried == ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
    assert turn.text == "ok then "  # narrow spaces and citation markers cleaned for speech


async def test_rejected_key_drops_provider_and_chain_reports_the_useful_error():
    groq = _llm(lambda req: httpx.Response(429), "groq")
    gemini = _llm(lambda req: httpx.Response(400, text='{"error": {"message": "Invalid Auth key."}}'), "gemini")
    chain = ChainLLM([groq, gemini])
    with pytest.raises(LLMError) as exc:
        await _turn(chain)
    assert exc.value.code == "rate_limited"  # not gemini's bad key
    assert chain.name == "groq" and chain.disabled and "gemini" in chain.disabled[0]
