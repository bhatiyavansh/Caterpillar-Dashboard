"""Hub behaviour over real localhost sockets: snapshot on connect, resync, failover, director, REST."""

import asyncio
import base64
import json

import pytest
import websockets

from tests.conftest import event, fake_source, machine, recv_json, recv_until


async def test_hello_then_snapshot_then_live_with_monotonic_seq(hub_server):
    src = await fake_source(hub_server.ws)
    await src.send(json.dumps(machine("EXC001")))
    await asyncio.sleep(0.2)
    async with websockets.connect(f"{hub_server.ws}/ws/live") as ws:
        hello = await recv_json(ws)
        assert hello["type"] == "hello" and hello["epoch"] == hub_server.hub.epoch
        snap = await recv_json(ws)
        assert snap["type"] == "snapshot" and [m["machine_id"] for m in snap["machines"]] == ["EXC001"]
        await src.send(json.dumps(machine("EXC002", ts="2026-09-23T10:00:01Z")))
        await src.send(json.dumps(event("x1")))
        msgs = await recv_until(ws, lambda m: m["type"] == "event")
        seqs = [hello["seq"], snap["seq"], *[m["seq"] for m in msgs]]
        assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
        assert msgs[-1]["rseq"] == snap["rseq_at"] + 1
        assert msgs[-1]["source_id"] == "test_src"
    await src.close()


async def test_resync_replays_exactly_the_missed_events(hub_server):
    src = await fake_source(hub_server.ws)
    async with websockets.connect(f"{hub_server.ws}/ws/live") as ws:
        await recv_until(ws, lambda m: m["type"] == "snapshot")
        for i in range(5):
            await src.send(json.dumps(event(f"a{i}")))
        got = await recv_until(ws, lambda m: m.get("id") == "a4")
        last_rseq = max(m["rseq"] for m in got if "rseq" in m)
        epoch = got[-1]["epoch"]
    for i in range(7):  # published while the client is away
        await src.send(json.dumps(event(f"b{i}")))
    await asyncio.sleep(0.3)
    async with websockets.connect(f"{hub_server.ws}/ws/live?since_rseq={last_rseq}&epoch={epoch}") as ws:
        hello = await recv_json(ws)
        assert hello["resumed"] is True
        msgs = await recv_until(ws, lambda m: m["type"] == "snapshot")
        replayed = [m for m in msgs if m["type"] == "event"]
        assert [m["id"] for m in replayed] == [f"b{i}" for i in range(7)]
        assert [m["rseq"] for m in replayed] == list(range(last_rseq + 1, last_rseq + 8))
        seqs = [hello["seq"], *[m["seq"] for m in msgs]]
        assert seqs == sorted(seqs)  # re-stamped seq keeps the per-connection order
        assert msgs[-1]["rseq_at"] == replayed[-1]["rseq"]
    await src.close()


async def test_resync_with_other_epoch_is_a_fresh_start(hub_server):
    async with websockets.connect(f"{hub_server.ws}/ws/live?since_rseq=3&epoch=deadbeef") as ws:
        hello = await recv_json(ws)
        snap = await recv_json(ws)
        assert hello["resumed"] is False and snap["type"] == "snapshot" and snap["events_truncated"] is False


async def test_resync_beyond_ring_is_reported_truncated(hub_server_factory):
    async with hub_server_factory(ring_size=5) as srv:
        src = await fake_source(srv.ws)
        for i in range(12):
            await src.send(json.dumps(event(f"c{i}")))
        await asyncio.sleep(0.3)
        async with websockets.connect(f"{srv.ws}/ws/live?since_rseq=1&epoch={srv.hub.epoch}") as ws:
            hello = await recv_json(ws)
            snap = await recv_json(ws)
            assert hello["resumed"] is False and snap["events_truncated"] is True
        r = await srv.http.get("/api/events", params={"since_rseq": 1, "epoch": srv.hub.epoch})
        assert r.json()["source"] == "db"
        assert [e["id"] for e in r.json()["events"]][:3] == ["c0", "c1", "c2"]
        await src.close()


async def test_source_failover_and_priority(hub_server):
    fake = await fake_source(hub_server.ws, "fake_a", "fake")
    await fake.send(json.dumps(machine("EXC001")))
    await asyncio.sleep(0.2)
    assert hub_server.hub.active_source_id == "fake_a"
    twin = await fake_source(hub_server.ws, "twin_b", "twin")  # higher priority than fake
    await twin.send(json.dumps(machine("EXC001")))
    await asyncio.sleep(0.3)
    assert hub_server.hub.active_source_id == "twin_b"
    await twin.close()
    for _ in range(6):  # keep fake alive; twin goes silent -> switch back after source_silence_s=1
        await fake.send(json.dumps(machine("EXC001")))
        await asyncio.sleep(0.3)
    assert hub_server.hub.active_source_id == "fake_a"
    kinds = [m["data"]["to"] for m in hub_server.hub.ring if m.get("event") == "source_changed"]
    assert kinds == ["fake_a", "twin_b", "fake_a"]
    await fake.close()
    await asyncio.sleep(1.6)
    assert hub_server.hub.active_source_id is None


async def test_c_sim_without_hello_is_receive_only(hub_server):
    """C's simulator sends no hello and never reads; the hub must never write to it."""
    async with websockets.connect(f"{hub_server.ws}/ws/ingest") as sim:
        await sim.send(json.dumps(machine("EXC001")))
        await asyncio.sleep(0.2)
        assert hub_server.hub.active_source_id == "sim"
        r = await hub_server.http.post("/api/director/unbuckle")
        assert r.status_code == 504  # routed via HTTP to :8100 (not running in tests), not via this socket
        with pytest.raises(TimeoutError):
            async with asyncio.timeout(0.5):
                await sim.recv()


class FakeSimHTTP:
    """Stands in for C's HTTP control API (labelled fake; tests never hit the network)."""

    def __init__(self):
        self.calls = []

    async def run_scenario(self, name, params):
        self.calls.append((name, params))
        return {"ok": True, "scenario": name, "events_emitted": [], "events": []}

    async def scenarios(self):
        return [{"name": "unbuckle"}]

    async def close(self):
        pass


async def test_director_routes_to_sim_http_with_alias_and_params(hub_server):
    fake_http = FakeSimHTTP()
    hub_server.app.state.sim = fake_http
    async with websockets.connect(f"{hub_server.ws}/ws/ingest") as sim:
        await sim.send(json.dumps(machine("EXC001")))
        await asyncio.sleep(0.2)
        r = await hub_server.http.post("/api/director/heavy_lift_slope", json={"machine_id": "EXC001"})
        assert r.status_code == 200 and r.json()["routed_to"] == "sim"
        assert fake_http.calls == [("heavy_lift", {"machine_id": "EXC001"})]
        assert (await hub_server.http.post("/api/director/nope")).status_code == 404


async def test_director_control_ack_and_timeout(hub_server):
    src = await fake_source(hub_server.ws, "ctl", "fake", control=True)
    await src.send(json.dumps(machine("EXC001")))
    await asyncio.sleep(0.2)

    async def answer_once():
        msg = json.loads(await src.recv())
        assert msg["type"] == "control" and msg["command"] == "worker_behind"
        await src.send(json.dumps({"type": "control_ack", "command_id": msg["command_id"], "ok": True}))

    t = asyncio.create_task(answer_once())
    r = await hub_server.http.post("/api/director/worker_proximity")
    await t
    assert r.status_code == 200 and r.json()["ack"]["ok"] is True
    r = await hub_server.http.post("/api/director/rain")  # nobody answers now
    assert r.status_code == 504
    await src.close()


async def test_director_without_source_is_503(hub_server):
    assert (await hub_server.http.post("/api/director/rain")).status_code == 503


async def test_post_event_stamps_and_snapshot_limits(hub_server):
    cv = {"type": "event", "event": "proximity_alert", "severity": "critical", "machine_id": "EXC001",
          "source": "webcam", "message": "Person detected 2.1 m behind EXC001",
          "data": {"distance_m": 2.1, "zone": "rear", "confidence": 0.8}}
    r = await hub_server.http.post("/api/events", json=cv)
    assert r.status_code == 201 and r.json()["id"].startswith("cv_")
    small = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8" + b"x" * 1000).decode()
    r = await hub_server.http.post("/api/events", json={**cv, "snapshot": small})
    url = r.json()["snapshot_url"]
    assert r.status_code == 201 and url.startswith("/api/cv/snapshots/")
    assert (await hub_server.http.get(url)).content.startswith(b"\xff\xd8")
    ring_evt = hub_server.hub.ring[-1]
    assert ring_evt["data"]["snapshot_url"] == url  # attached before broadcast
    big = "data:image/jpeg;base64," + base64.b64encode(b"x" * (150 * 1024 + 1)).decode()
    assert (await hub_server.http.post("/api/events", json={**cv, "snapshot": big})).status_code == 413
    assert (await hub_server.http.post("/api/events", json={"event": 3})).status_code == 422


async def test_history_replay_and_fleet(hub_server):
    src = await fake_source(hub_server.ws)
    now = __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime())
    await src.send(json.dumps(machine("EXC001", ts=now)))
    await src.send(json.dumps(event("h1")))
    await asyncio.sleep(0.4)
    fleet = (await hub_server.http.get("/api/fleet")).json()
    assert fleet["count"] == 1 and fleet["source"]["source_id"] == "test_src"
    hist = (await hub_server.http.get("/api/machines/EXC001/history")).json()
    assert hist["count"] == 1 and hist["states"][0]["machine_id"] == "EXC001"
    assert (await hub_server.http.get("/api/machines/NOPE/history")).status_code == 404
    rep = (await hub_server.http.get("/api/replay", params={"from": "2026-01-01T00:00:00Z"})).json()
    assert len(rep["states"]) == 1 and any(e["id"] == "h1" for e in rep["events"])
    await src.close()


async def test_stubs_are_honest(hub_server):
    r = await hub_server.http.post("/api/assistant", json={})
    assert r.status_code == 501 and r.headers["X-Stub"] == "1"
    health = (await hub_server.http.get("/api/health")).json()
    assert {"method": "POST", "path": "/api/assistant", "phase": "B"} in health["stubs"]
    assert "/api/health" not in {s["path"] for s in health["stubs"]}
