"""Gate: 10 machines x 20 consumers x 30 s, zero event loss, p95 fan-out < 50 ms.

Real processes: the hub (python -m copilot) and fake_sim (10 machines @ 1 Hz, an event every
0.2 s) run as subprocesses on localhost; 20 consumers run here. Fan-out latency is hub publish
(`hub_ts`) -> consumer receive, over every message; end-to-end (producer `ts` -> receive) is
reported for events as extra information.
"""

import asyncio
import json
import statistics
import sys
import time

import websockets

from copilot.config import BACKEND_DIR
from copilot.timeutil import parse_ts
from tests.conftest import free_port, start_hub_process

CONSUMERS = 20
DURATION_S = 30
MACHINES = 10


async def test_10_machines_20_consumers_30s_zero_loss_p95_under_50ms(tmp_path):
    port = free_port()
    hub = start_hub_process(port, tmp_path / "hub.db")
    sent_log = tmp_path / "sent.jsonl"
    stats = [{"events": [], "rseq": [], "fanout": [], "e2e": [], "machines": set()} for _ in range(CONSUMERS)]
    stop = asyncio.Event()

    async def consume(i: int) -> None:
        s = stats[i]
        async with websockets.connect(f"ws://127.0.0.1:{port}/ws/live", max_size=2**24) as ws:
            while not stop.is_set():
                try:
                    async with asyncio.timeout(0.5):
                        text = await ws.recv()
                except TimeoutError:
                    continue
                now = time.time()
                m = json.loads(text)
                if m["type"] in ("machine_state", "worker_state", "event", "heartbeat"):
                    s["fanout"].append((now - parse_ts(m["hub_ts"])) * 1000)
                if m["type"] == "machine_state":
                    s["machines"].add(m["machine_id"])
                if m["type"] == "event":
                    s["rseq"].append(m["rseq"])
                    if m.get("source_id") == "fake_sim":
                        s["events"].append(m["id"])
                        s["e2e"].append((now - parse_ts(m["ts"])) * 1000)

    try:
        consumers = [asyncio.create_task(consume(i)) for i in range(CONSUMERS)]
        await asyncio.sleep(0.5)
        fake = await asyncio.create_subprocess_exec(
            sys.executable, "scripts/fake_sim.py", "--url", f"ws://127.0.0.1:{port}/ws/ingest",
            "--machines", str(MACHINES), "--event-interval", "0.2", "--duration", str(DURATION_S),
            "--sent-log", str(sent_log),
            cwd=BACKEND_DIR, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        async with asyncio.timeout(DURATION_S + 30):
            out, _ = await fake.communicate()
        assert fake.returncode == 0, out.decode()
        await asyncio.sleep(2.0)  # drain
        stop.set()
        await asyncio.gather(*consumers)
    finally:
        hub.terminate()
        hub.wait(timeout=10)

    sent = [json.loads(line)["id"] for line in sent_log.read_text().splitlines()]
    assert len(sent) >= DURATION_S * 4, f"fake_sim sent only {len(sent)} events"
    all_fanout = sorted(x for s in stats for x in s["fanout"])
    p50 = statistics.median(all_fanout)
    p95 = all_fanout[int(0.95 * (len(all_fanout) - 1))]
    p99 = all_fanout[int(0.99 * (len(all_fanout) - 1))]
    e2e = sorted(x for s in stats for x in s["e2e"])
    e2e_p95 = e2e[int(0.95 * (len(e2e) - 1))]
    print(
        f"\nload: {len(sent)} events sent; {CONSUMERS} consumers; {len(all_fanout)} messages measured\n"
        f"fan-out ms: p50 {p50:.2f}  p95 {p95:.2f}  p99 {p99:.2f}  max {all_fanout[-1]:.2f}\n"
        f"events end-to-end (producer ts -> consumer) ms: p95 {e2e_p95:.2f}"
    )
    for i, s in enumerate(stats):
        assert s["events"] == sent, f"consumer {i}: lost/reordered events ({len(s['events'])}/{len(sent)})"
        assert s["rseq"] == list(range(s["rseq"][0], s["rseq"][0] + len(s["rseq"]))), f"consumer {i}: rseq gap"
        assert len(s["machines"]) == MACHINES
    assert p95 < 50.0, f"p95 fan-out {p95:.2f} ms"
