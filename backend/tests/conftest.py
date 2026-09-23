"""Shared fixtures. Servers bind 127.0.0.1 only; pytest-socket blocks every other host."""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
import uvicorn
import websockets

from copilot.app import create_app
from copilot.config import BACKEND_DIR, REPO_DIR, Settings

FIXTURES = Path(__file__).parent / "fixtures"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def make_settings(tmp_path: Path, **kw) -> Settings:
    base = dict(
        db_path=tmp_path / "hub.db",
        snapshot_dir=tmp_path / "cv_snapshots",
        log_dir=tmp_path / "logs",
        cache_dir=tmp_path / "cache",
        sim_url="http://127.0.0.1:9",  # nothing listens there; real sim calls are replaced by fakes
        heartbeat_s=0.5,
        source_silence_s=1.0,
        persist_flush_s=0.1,
        control_ack_timeout_s=0.5,
    )
    base.update(kw)
    return Settings(**base)


@pytest.fixture
async def hub_server(tmp_path):
    """In-process hub on a random localhost port. Use `hub_server_factory` for custom settings."""
    async with _serve(make_settings(tmp_path)) as srv:
        yield srv


@pytest.fixture
def hub_server_factory(tmp_path):
    def make(llm=None, ml=None, **kw):
        return _serve(make_settings(tmp_path, **kw), llm=llm, ml=ml)


    return make


class _serve:
    def __init__(self, settings: Settings, llm=None, ml=None) -> None:
        self.settings = settings
        self.llm = llm
        self.ml = ml

    async def __aenter__(self):
        port = free_port()
        app = create_app(self.settings, llm=self.llm, ml=self.ml or FakeML(), embedder_factory=None)
        cfg = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
        self.server = uvicorn.Server(cfg)
        self.task = asyncio.create_task(self.server.serve())
        for _ in range(500):
            if self.server.started:
                break
            await asyncio.sleep(0.01)
        self.http = httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", timeout=5)
        return SimpleNamespace(
            http=self.http, ws=f"ws://127.0.0.1:{port}", app=app, hub=app.state.hub, port=port
        )

    async def __aexit__(self, *exc):
        await self.http.aclose()
        self.server.should_exit = True
        await self.task


async def recv_json(ws, within: float = 3.0) -> dict:
    async with asyncio.timeout(within):
        return json.loads(await ws.recv())


async def recv_until(ws, pred, within: float = 5.0) -> list[dict]:
    """Collect messages until pred(msg) is true (inclusive)."""
    out: list[dict] = []
    async with asyncio.timeout(within):
        while True:
            m = json.loads(await ws.recv())
            out.append(m)
            if pred(m):
                return out


async def fake_source(url: str, source_id: str = "test_src", kind: str = "fake", control: bool = False):
    ws = await websockets.connect(f"{url}/ws/ingest")
    await ws.send(json.dumps({"type": "source_hello", "source_id": source_id, "kind": kind,
                              "format": "contract", "accepts_control": control}))
    return ws


def machine(mid: str, ts: str = "2026-09-23T10:00:00Z", **kw) -> dict:
    base = json.loads((REPO_DIR / "fixtures" / "machine_state.json").read_text())[0]
    return {**base, "machine_id": mid, "ts": ts, **kw}


def event(eid: str, kind: str = "proximity_alert", mid: str = "EXC001", **kw) -> dict:
    return {"type": "event", "id": eid, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "event": kind, "severity": "high", "machine_id": mid, "source": "simulator",
            "message": f"test {eid}", "data": {}, **kw}


# ------------------------------------------------------------------ subprocess helpers (load tests)


def start_hub_process(port: int, db: Path, **env) -> subprocess.Popen:
    e = {**os.environ, "COPILOT_DB_PATH": str(db), "COPILOT_RAG_EMBEDDINGS": "0",
         "COPILOT_LOG_DIR": str(db.parent / "logs"), "COPILOT_CACHE_DIR": str(db.parent / "cache"),
         **{k: str(v) for k, v in env.items()}}
    p = subprocess.Popen(
        [sys.executable, "-m", "copilot", "--host", "127.0.0.1", "--port", str(port)],
        cwd=BACKEND_DIR, env=e, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            if httpx.get(f"http://127.0.0.1:{port}/health", timeout=0.5).status_code == 200:
                return p
        except httpx.HTTPError:
            time.sleep(0.1)
    p.kill()
    raise RuntimeError("hub process did not start:\n" + (p.stdout.read().decode() if p.stdout else ""))


# ------------------------------------------------------------------ labelled fakes (no network, no C data)


class FakeML:
    """Deterministic ML double (labelled provenance 'fake')."""

    name = "fake"

    def __init__(self):
        self.what_if_calls = []

    def status(self):
        return {"mode": "fake"}

    async def estimate_task(self, f):
        return {"p10": 170.0, "p50": 200.0, "p90": 250.0, "unit": "min", "reasons": [
            {"feature": "soil", "label": "Clay", "impact_min": 15}], "provenance": "fake"}

    async def anomalies(self, machine_id, since_hours=24, live=None):
        rows = [{"machine_id": "EXC002", "type": "excessive_idling", "related": ["seatbelt_violation"],
                 "score": 0.93, "fuel_cost_inr": 450, "evidence": {"idle_min": 50}}]
        return {"anomalies": [r for r in rows if machine_id in (None, r["machine_id"])], "provenance": "fake"}

    async def maintenance(self, machine_id):
        return {"forecast": [{"machine_id": machine_id or "EXC001", "component": "hydraulic_pump",
                              "health_pct": 77.8, "hours_to_service": 1315, "due_date": "2027-02-01"}],
                "provenance": "fake"}

    async def what_if(self, params):
        self.what_if_calls.append(params)
        await asyncio.sleep(0.05)
        return {"params": params, "current": {"throughput_m3": 100}, "scenario": {"throughput_m3": 89},
                "delta": {"throughput_m3": "-11%"}, "provenance": "fake"}

    async def working_risk(self, **env):
        return {"score": 10, "level": "low", "reasons": [], "provenance": "fake"}

    async def fleet_kpis(self, snap):
        return {"active_machines": len(snap.get("machines", [])), "provenance": "fake"}

    async def training_profiles(self):
        return {"profiles": [], "provenance": "fake"}

    async def owner_summary(self, days=7):
        return {"days": days, "fuel_l": 12234.3, "fuel_spend_inr": 1101087, "idle_cost_inr": 91000,
                "idle_cost_share_pct": 8.3, "utilization_pct": 71.2, "co2_kg": 32786, "daily": [],
                "top_anomalies": [], "provenance": "fake"}


class FakeSimHTTP:
    """Stands in for C's HTTP control API (:8100), labelled fake."""

    def __init__(self):
        self.calls = []
        self.task_list = json.loads((REPO_DIR / "fixtures" / "tasks.json").read_text())

    async def run_scenario(self, name, params):
        self.calls.append(("scenario", name, params))
        return {"ok": True, "scenario": name, "events_emitted": [], "events": []}

    async def scenarios(self):
        return [{"name": "unbuckle"}]

    async def tasks(self, operator_id=None):
        self.calls.append(("tasks", operator_id))
        return [t for t in self.task_list if operator_id in (None, t["operator_id"])]

    async def reorder_tasks(self, operator_id, reason):
        self.calls.append(("reorder", operator_id, reason))
        return {"operator_id": operator_id, "old_order": ["T-0001"], "new_order": ["T-0001"], "reason": reason}

    async def close(self):
        pass
