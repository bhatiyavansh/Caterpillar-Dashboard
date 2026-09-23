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
    def make(**kw):
        return _serve(make_settings(tmp_path, **kw))

    return make


class _serve:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def __aenter__(self):
        port = free_port()
        app = create_app(self.settings)
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
    e = {**os.environ, "COPILOT_DB_PATH": str(db), **{k: str(v) for k, v in env.items()}}
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
