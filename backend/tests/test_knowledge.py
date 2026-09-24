"""Phase C gate: protocols (exactly one per safety event, steps verbatim), manual RAG, reports, CV."""

import base64
import json
import time

import pytest

from copilot.agent.llm import FakeLLM, FakeStep
from copilot.config import BACKEND_DIR
from copilot.knowledge.manuals import HashEmbedder, ManualIndex, corpus_dirs, corpus_text
from copilot.knowledge.protocols import SAFETY_EVENTS, ProtocolError, ProtocolLibrary
from tests.conftest import FakeSimHTTP, event, machine

PROTOCOLS = BACKEND_DIR / "data" / "protocols"
MANUALS = BACKEND_DIR / "data" / "manuals"
NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@pytest.fixture(scope="module")
def library():
    return ProtocolLibrary.load(PROTOCOLS, corpus_text(MANUALS))


# --------------------------------------------------------------------------- protocols


def test_every_safety_event_maps_to_exactly_one_protocol(library):
    for kind in SAFETY_EVENTS:
        hits = [p.id for p in library.protocols if p.matches({"event": kind, "data": {}})]
        assert len(hits) == 1, (kind, hits)


def test_steps_are_verbatim_from_the_file(library):
    for p in library.protocols:
        raw = open(p.path, encoding="utf-8").read()
        for step in p.ref()["steps"]:
            assert f'"{step}"' in raw, (p.id, step)  # byte-identical to the quoted YAML string
        assert p.ref()["steps"] == list(p.steps)


def test_regulation_quotes_are_verbatim_in_the_public_corpus(library):
    corpus = corpus_text(MANUALS)
    quoted = [p for p in library.protocols if p.regulation]
    assert quoted, "expected at least one OSHA-quoting protocol"
    for p in quoted:
        assert p.regulation["quote"] in corpus, p.id
    for p in library.protocols:
        assert p.regulation or "Demo site SOP" in p.source, p.id


def test_hydraulic_protocol_only_for_hydraulic_maintenance(library):
    hot = {"event": "maintenance_due", "data": {"component": "hydraulic_pump"}}
    other = {"event": "maintenance_due", "data": {"component": "engine"}}
    assert library.for_event(hot).id == "PRT-HYD-OVERHEAT"
    assert library.for_event(other) is None


def test_load_refuses_a_library_missing_a_safety_protocol(tmp_path):
    for f in PROTOCOLS.glob("*.md"):
        if f.name != "fatigue_alert.md":
            (tmp_path / f.name).write_text(f.read_text())
    with pytest.raises(ProtocolError, match="fatigue_alert"):
        ProtocolLibrary.load(tmp_path)


def test_load_refuses_a_misquoted_regulation(tmp_path):
    src = (PROTOCOLS / "seatbelt_unfastened.md").read_text().replace("shall be provided", "should be provided")
    for f in PROTOCOLS.glob("*.md"):
        (tmp_path / f.name).write_text(src if f.name == "seatbelt_unfastened.md" else f.read_text())
    with pytest.raises(ProtocolError, match="not verbatim"):
        ProtocolLibrary.load(tmp_path, corpus_text(MANUALS))


async def test_hub_attaches_protocol_deterministically(hub_server):
    await hub_server.http.post("/api/events", json={"event": "proximity_alert", "severity": "critical",
                                                     "machine_id": "EXC001", "source": "webcam",
                                                     "message": "Person 2 m behind EXC001", "data": {"distance_m": 2.0}})
    evt = hub_server.hub.ring[-1]
    assert evt["protocol"]["id"] == "PRT-PROXIMITY"
    lib = hub_server.app.state.protocols
    assert evt["protocol"]["steps"] == list(lib.by_id["PRT-PROXIMITY"].steps)
    r = await hub_server.http.get("/api/protocols/PRT-PROXIMITY")
    assert r.json()["steps"] == evt["protocol"]["steps"]


# --------------------------------------------------------------------------- manual RAG


@pytest.fixture(scope="module")
def index():
    return ManualIndex.build(MANUALS, HashEmbedder())


@pytest.fixture(scope="module")
def full_index():
    """The production corpus: real manuals plus the synthetic demo knowledge."""
    return ManualIndex.build(corpus_dirs(BACKEND_DIR / "data"), HashEmbedder())


def test_fault_code_regex_hit_first(index):
    res = index.search("what does HYD-118 mean")
    assert res["hits"][0]["match"] == "fault_code"
    assert res["hits"][0]["citation"].endswith("p. 2")


def test_rag_eval_questions_hit_at_5(index):
    from scripts.rag_eval import is_synthetic, run

    hits, n, lines = run(index, lambda c: not is_synthetic(c))
    assert hits == n, "\n".join(line for line in lines if line.startswith("FAIL"))


def test_synthetic_eval_questions_hit_at_5_on_the_full_corpus(full_index):
    from scripts.rag_eval import is_synthetic, run

    hits, n, lines = run(full_index, is_synthetic)
    assert n >= 10 and hits == n, "\n".join(line for line in lines if line.startswith("FAIL"))


def test_synthetic_knowledge_is_labelled_and_never_passes_for_official(full_index):
    syn = [c for c in full_index.chunks if c.synthetic]
    assert {c.domain for c in syn} >= {"training", "safety", "machine", "maintenance"}
    for c in syn:
        assert c.citation.startswith("Synthetic demo knowledge: ") and "(synthetic demo knowledge)" in c.title
        assert "Not a Caterpillar publication" in c.source
    hit = full_index.search("What should I check before starting the machine?")["hits"][0]
    assert hit["synthetic"] is True and hit["domain"] == "training"
    real = [c for c in full_index.chunks if not c.synthetic]
    assert real and all(c.domain in ("regulation", "site_manual") for c in real)


def test_protocol_quotes_are_checked_against_real_documents_only(tmp_path):
    """A regulation quote that exists only in the synthetic corpus must not validate a protocol."""
    synthetic_only = "People on foot should wear high-visibility clothing"
    assert synthetic_only not in corpus_text(MANUALS)


def test_specialist_profile_reorders_the_shared_index(full_index):
    from copilot.knowledge.retrieval import PROFILES, profile_for

    q = "why wear the seatbelt"
    training = full_index.search(q, profile=PROFILES["training"])
    maint = full_index.search(q, profile=PROFILES["maintenance"])
    assert training["profile"] == "training" and training["hits"][0]["domain"] in ("training", "safety")

    def rank(res, domain):
        return next((i for i, h in enumerate(res["hits"]) if h["domain"] == domain), 99)

    q2 = "hydraulic oil overheating what to do"
    assert rank(full_index.search(q2, profile=PROFILES["maintenance"]), "maintenance") <= \
        rank(full_index.search(q2, profile=PROFILES["training"]), "maintenance")
    assert maint["hits"], "a profile re-weights; it does not empty the results"
    assert profile_for("general", "training").name == "training" and profile_for(None, "cab").name == "general"


def test_stale_index_is_rebuilt_not_served(tmp_path):
    import shutil

    from copilot.app import load_rag

    data = tmp_path / "data"
    shutil.copytree(BACKEND_DIR / "data" / "manuals", data / "manuals")
    ManualIndex.build([data / "manuals"], None).save(data / "index")
    (data / "synthetic" / "training").mkdir(parents=True)
    shutil.copy(BACKEND_DIR / "data" / "synthetic" / "training" / "prestart_inspection.md",
                data / "synthetic" / "training")
    rag = load_rag(data, None)
    assert any(c.synthetic for c in rag.chunks), "a document added after `make index` must still be searchable"


def test_out_of_corpus_question_is_not_found(index):
    assert index.search("recipe for chocolate cake")["found"] is False


def test_index_round_trip_never_mixes_vector_spaces(index, tmp_path):
    index.save(tmp_path)
    same = ManualIndex.load(tmp_path, HashEmbedder())
    assert same.dense and same.provenance == "manual_rag (bm25 + hash-fake)"

    class Other(HashEmbedder):
        name = "other-model"

    other = ManualIndex.load(tmp_path, Other())
    assert not other.dense and other.provenance == "manual_rag (bm25 only)"


# --------------------------------------------------------------------------- reports + CV through the app


@pytest.fixture
async def kn_srv(hub_server_factory):
    llm = FakeLLM([])
    async with hub_server_factory(llm=llm, llm_first_token_s=0.3, llm_total_s=2.0) as srv:
        srv.llm = llm
        srv.app.state.sim = FakeSimHTTP()
        srv.hub.publish_machine(machine("EXC001", ts=NOW, fuel_level_pct=84.4, seatbelt="fastened",
                                        fault_codes=["HYD-118"]))
        yield srv


def _jpeg() -> str:
    return "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8" + b"x" * 500).decode()


async def test_incident_from_cv_event_attaches_snapshot_protocol_and_validated_draft(kn_srv):
    r = await kn_srv.http.post("/api/events", json={
        "event": "proximity_alert", "severity": "critical", "machine_id": "EXC001", "source": "webcam",
        "message": "Person detected 2.1 m behind EXC001", "data": {"distance_m": 2.1, "zone": "rear"},
        "snapshot": _jpeg()})
    evt_id = r.json()["id"]
    good = {"title": "Person behind EXC001", "summary": "Webcam saw a person 2.1 m behind EXC001.",
            "timeline": [], "contributing_factors": [], "recommendations": []}
    bad = {**good, "summary": "A person was 0.4 m behind EXC001 for 12 seconds."}  # invented numbers
    kn_srv.llm.script = [
        FakeStep(tool_calls=[("create_incident", {"machine_id": "EXC001", "summary": "person behind me",
                                                  "event_id": evt_id})]),
        FakeStep(text="Please confirm the incident report."),
        FakeStep(tool_calls=[("submit_draft", bad)]),   # report draft attempt 1: rejected (ungrounded)
        FakeStep(tool_calls=[("submit_draft", good)]),  # attempt 2: accepted
    ]
    body = (await kn_srv.http.post("/api/assistant", json={"surface": "cab", "message": "log it"},
                                   headers={"Accept": "application/json"})).json()
    action = body["actions"][0]["action_id"]
    assert (await kn_srv.http.post(f"/api/actions/{action}/confirm")).json()["status"] == "confirmed"
    inc = (await kn_srv.http.get("/api/incidents")).json()["incidents"][0]
    assert inc["snapshot_url"].startswith("/api/cv/snapshots/")
    assert inc["protocol"]["id"] == "PRT-PROXIMITY"
    assert inc["draft"]["summary"] == good["summary"] and inc["draft_source"].endswith("(after retry)")
    retry_note = kn_srv.llm.calls[3]["messages"][-1]["content"][0]["content"]
    assert retry_note.startswith("Rejected: ungrounded value") and "12" in retry_note


async def test_incident_template_when_llm_fails_twice(kn_srv):
    bad = {"title": "x", "summary": "EXC001 hit 99 km/h", "timeline": [], "contributing_factors": [],
           "recommendations": []}
    kn_srv.llm.script = [FakeStep(tool_calls=[("submit_draft", bad)]), FakeStep(tool_calls=[("submit_draft", bad)])]
    r = await kn_srv.http.post("/api/incidents", json={"machine_id": "EXC001", "summary": "near miss at gate"})
    assert r.status_code == 201
    inc = (await kn_srv.http.get("/api/incidents")).json()["incidents"][0]
    assert inc["draft_source"] == "template (validation failed twice)"
    assert "99" not in json.dumps(inc["draft"])


async def test_work_order_parts_must_come_from_forecast(kn_srv):
    wo_bad = {"title": "Pump", "description": "Service hydraulic pump", "priority": "high",
              "suggested_parts": ["Flux capacitor"], "checks": []}
    kn_srv.llm.script = [FakeStep(tool_calls=[("submit_draft", wo_bad)]), FakeStep(error="overloaded")]
    r = await kn_srv.http.post("/api/work-orders", json={"machine_id": "EXC001", "issue": "Hydraulic oil hot"})
    assert r.status_code == 201
    wo = (await kn_srv.http.get("/api/work-orders")).json()["work_orders"][0]
    assert wo["draft_source"] == "template (llm overloaded)"
    assert "Flux capacitor" not in wo["draft"]["suggested_parts"]
    assert "HYD-118" in wo["draft"]["description"]


async def test_weekly_report_is_cached_and_labelled(kn_srv):
    kn_srv.llm.script = [FakeStep(error="unavailable")]
    first = (await kn_srv.http.get("/api/reports/weekly")).json()
    second = (await kn_srv.http.get("/api/reports/weekly")).json()
    assert first["generated_at"] == second["generated_at"]  # served from cache
    assert first["prose_source"].startswith("template") and first["provenance"]["kpis"] == "fake"


async def test_anomaly_explanations_cached_by_stable_key(kn_srv):
    kn_srv.llm.script = [FakeStep(tool_calls=[("submit_draft", {"text": "EXC002 idled 50 min, costing about INR 450."})])]
    a = (await kn_srv.http.get("/api/anomalies", params={"machine_id": "EXC002", "explain": True})).json()
    b = (await kn_srv.http.get("/api/anomalies", params={"machine_id": "EXC002", "explain": True})).json()
    first = a["data"]["anomalies"][0]["explanation"]
    assert first["explanation"].startswith("EXC002 idled 50 min") and first["cached"] is False
    assert b["data"]["anomalies"][0]["explanation"]["cached"] is True
    assert len(kn_srv.llm.calls) == 1


async def test_snapshot_limit_and_describe_scene_flag(kn_srv, monkeypatch):
    big = "data:image/jpeg;base64," + base64.b64encode(b"x" * (150 * 1024 + 1)).decode()
    assert (await kn_srv.http.post("/api/events", json={"event": "proximity_alert", "severity": "high",
                                                         "machine_id": "EXC001", "snapshot": big})).status_code == 413
    r = await kn_srv.http.post("/api/events", json={"event": "proximity_alert", "severity": "high",
                                                     "machine_id": "EXC001", "snapshot": _jpeg()})
    eid = r.json()["id"]
    kn_srv.llm.script = [FakeStep(tool_calls=[("describe_scene", {"event_id": eid})]), FakeStep(text="Disabled.")]
    monkeypatch.setenv("CV_DESCRIBE", "0")
    body = (await kn_srv.http.post("/api/assistant", json={"surface": "command", "message": "what is in the frame"},
                                   headers={"Accept": "application/json"})).json()
    res = next(e for e in body["events"] if e["event"] == "tool_result")["data"]
    assert res["ok"] is False and res["provenance"] == "flag"
    monkeypatch.setenv("CV_DESCRIBE", "1")
    kn_srv.llm.script = [FakeStep(tool_calls=[("describe_scene", {"event_id": eid})]), FakeStep(text="One person.")]
    kn_srv.llm.image_description = "One person standing behind a yellow excavator."
    body = (await kn_srv.http.post("/api/assistant", json={"surface": "command", "message": "what is in the frame"},
                                   headers={"Accept": "application/json"})).json()
    res = next(e for e in body["events"] if e["event"] == "tool_result")["data"]
    assert res["ok"] is True and res["provenance"] == "vision_llm (advisory)"


def test_safety_path_never_calls_the_llm(library):
    """Attaching a protocol is pure data: no LLM object is reachable from the library."""
    evt = event("s1", kind="seatbelt_unfastened")
    library.enrich(evt)
    assert evt["protocol"]["id"] == "PRT-SEATBELT"
    assert not any("llm" in k.lower() for k in vars(library))
