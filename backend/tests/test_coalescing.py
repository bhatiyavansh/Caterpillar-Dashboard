"""Per-machine coalescing and seq-ordered drain (no network: Hub with in-memory fake sockets)."""

import json

from copilot.hub.hub import Hub
from copilot.hub.outbox import Outbox
from tests.conftest import event, machine, make_settings


def test_outbox_coalesces_states_but_keeps_every_reliable():
    ob = Outbox(max_reliable=100)
    seq = 0
    for tick in range(50):
        for mid in ("A", "B", "C"):
            seq += 1
            ob.put_state(f"m:{mid}", seq, f"{mid}{tick}")
        if tick % 10 == 0:
            seq += 1
            ob.put_reliable(seq, f"E{tick}")
    out = ob.drain()
    assert [x for x in out if x.startswith("E")] == ["E0", "E10", "E20", "E30", "E40"]
    assert sorted(x for x in out if not x.startswith("E")) == ["A49", "B49", "C49"]
    assert ob.coalesced == 147
    assert ob.drain() == []


def test_outbox_overflow_flag():
    ob = Outbox(max_reliable=3)
    assert all(ob.put_reliable(i, str(i)) for i in range(3))
    assert ob.put_reliable(4, "4") is False and ob.overflowed


class FakeWS:
    async def send_text(self, text):  # never called: we drain the outbox directly
        raise AssertionError

    async def close(self, code=1000, reason=""):
        pass


async def test_hub_paused_client_gets_latest_state_per_machine_and_all_events(tmp_path):
    hub = Hub(make_settings(tmp_path))
    client = hub.register_client(FakeWS(), None, None)
    client.outbox.drain()  # hello + snapshot
    ids = [f"EXC00{i}" for i in range(10)]
    for tick in range(100):
        ts = f"2026-09-23T10:{tick // 60:02d}:{tick % 60:02d}Z"
        for mid in ids:
            hub.publish_machine(machine(mid, ts=ts, fuel_level_pct=float(tick)))
        if tick % 7 == 0:
            hub.publish_event(event(f"e{tick}"))
    msgs = [json.loads(t) for t in client.outbox.drain()]
    states = [m for m in msgs if m["type"] == "machine_state"]
    events = [m for m in msgs if m["type"] == "event"]
    assert len(states) == 10  # 1000 published, coalesced to the latest per machine
    assert {m["fuel_level_pct"] for m in states} == {99.0}
    assert [e["id"] for e in events] == [f"e{t}" for t in range(0, 100, 7)]
    assert [e["rseq"] for e in events] == list(range(1, 16))  # contiguous
    seqs = [m["seq"] for m in msgs]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)


async def test_older_state_does_not_replace_newer(tmp_path):
    hub = Hub(make_settings(tmp_path))
    hub.publish_machine(machine("EXC001", ts="2026-09-23T10:00:05Z", fuel_level_pct=50.0))
    hub.publish_machine(machine("EXC001", ts="2026-09-23T10:00:01Z", fuel_level_pct=99.0))  # stale burst
    assert hub.world.machines["EXC001"]["fuel_level_pct"] == 50.0
