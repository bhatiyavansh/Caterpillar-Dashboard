"""A consumer that stops reading is disconnected (4008) without affecting others, and loses nothing:
it reconnects with since_rseq and receives exactly the events it missed. Real hub process."""

import asyncio
import json

import httpx
import websockets

from tests.conftest import free_port, start_hub_process

N_EVENTS = 3000
PAD = "x" * 4000  # 4 KB per event (~12 MB total) so kernel socket buffers cannot absorb it


async def test_slow_consumer_disconnected_then_resumes_without_loss(tmp_path):
    port = free_port()
    proc = start_hub_process(port, tmp_path / "hub.db", COPILOT_MAX_PENDING_RELIABLE=200,
                             COPILOT_SLOW_SEND_TIMEOUT_S=1)
    base = f"ws://127.0.0.1:{port}"
    try:
        healthy_ids: list[str] = []
        slow_ids: list[str] = []
        slow_close_code = None

        async def healthy():
            async with websockets.connect(f"{base}/ws/live", max_size=2**24) as ws:
                async for text in ws:
                    m = json.loads(text)
                    if m["type"] == "event" and m["id"].startswith("load_"):
                        healthy_ids.append(m["id"])
                        if len(healthy_ids) == N_EVENTS:
                            return

        slow = await websockets.connect(f"{base}/ws/live", max_queue=1, max_size=2**24)
        healthy_task = asyncio.create_task(healthy())
        await asyncio.sleep(0.3)

        async with websockets.connect(f"{base}/ws/ingest") as src:
            await src.send(json.dumps({"type": "source_hello", "source_id": "burst", "kind": "fake"}))
            for i in range(N_EVENTS):
                await src.send(json.dumps({
                    "type": "event", "id": f"load_{i:05d}", "ts": "2026-09-23T10:00:00Z",
                    "event": "v2i_suggestion", "severity": "info", "machine_id": "TRK001",
                    "source": "v2i", "message": "burst", "data": {"pad": PAD},
                }))
                if i % 50 == 49:  # ~5000 events/s: far above any real source, still a burst
                    await asyncio.sleep(0.01)
            async with asyncio.timeout(30):
                await healthy_task
            assert len(healthy_ids) == N_EVENTS and len(set(healthy_ids)) == N_EVENTS

            # the hub must have cut the non-reading client off by now
            async with httpx.AsyncClient() as http:
                for _ in range(100):
                    health = (await http.get(f"http://127.0.0.1:{port}/api/health")).json()
                    if health["counters"]["slow_disconnects"] >= 1:
                        break
                    await asyncio.sleep(0.1)
            assert health["counters"]["slow_disconnects"] >= 1, "hub never disconnected the slow consumer"

            # the slow reader now drains whatever was buffered before it was cut off
            last_rseq, epoch = 0, None
            try:
                async with asyncio.timeout(15):
                    async for text in slow:
                        m = json.loads(text)
                        epoch = m.get("epoch", epoch)
                        if "rseq" in m:
                            last_rseq = m["rseq"]
                        if m["type"] == "event" and m["id"].startswith("load_"):
                            slow_ids.append(m["id"])
            except websockets.ConnectionClosed:
                pass
            slow_close_code = slow.close_code
            assert len(slow_ids) < N_EVENTS, "slow consumer should have been cut off"

            async with websockets.connect(
                f"{base}/ws/live?since_rseq={last_rseq}&epoch={epoch}", max_size=2**24
            ) as again:
                hello = json.loads(await again.recv())
                assert hello["resumed"] is True
                async with asyncio.timeout(15):
                    async for text in again:
                        m = json.loads(text)
                        if m["type"] == "snapshot":
                            break
                        if m["type"] == "event" and m["id"].startswith("load_"):
                            slow_ids.append(m["id"])
        assert sorted(slow_ids) == sorted(healthy_ids), "zero loss after resume"
        assert len(slow_ids) == len(set(slow_ids)), "no duplicates after resume"
        print(f"\nslow consumer: close code {slow_close_code}, resumed from rseq {last_rseq}")
    finally:
        proc.terminate()
        proc.wait(timeout=10)
