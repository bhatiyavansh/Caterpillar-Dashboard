"""Control API on :8100.

Serves the director (POST /scenario/*), the world snapshot (GET /state), the
task endpoints the `intelligence` wrappers call, and - in standalone mode - the
live WebSocket that A and D build against.
"""

from __future__ import annotations

import logging
from contextlib import AbstractAsyncContextManager
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .emitter import Emitter, StandaloneBroadcaster
from . import config
from .config import AUTO_HAZARD_BASE_INTERVAL_S, AUTO_HAZARDS
from .scenarios import EMIT_SCRIPTED_EVENTS, SCENARIOS, ScenarioEngine
from .site import SITE_LAYOUT
from .world import World

log = logging.getLogger("simulator.api")


class SimulatorService:
    """Holds the one World and the one ScenarioEngine the API talks to."""

    def __init__(self, seed: int = 42) -> None:
        self.world = World(seed=seed)
        self.engine = ScenarioEngine(self.world)
        self.broadcaster = StandaloneBroadcaster()
        self.emitter = Emitter(self.broadcaster)
        self.mode = "standalone"
        self._next_hazard_s = AUTO_HAZARD_BASE_INTERVAL_S

    def _auto_hazard(self) -> None:
        """Fire a random hazard scenario when the site is dialled up.

        It reuses the demo scenarios rather than inventing a second code path,
        so an auto-fired hazard is indistinguishable from a button press — and
        six of them go through the real detectors, not scripted events.
        """
        intensity = config.SITE_INTENSITY
        if intensity <= 1.0:
            return
        if self.world.sim_time_s < self._next_hazard_s:
            return

        # Several hazards latch until something clears them — heavy_lift holds
        # the load out, unbuckle keeps the belt off. Left alone they stack up
        # and the highest-severity one masks everything after it, so the site
        # sits on one permanent alarm. Clear the last one before firing next.
        self._clear_auto_hazard()

        name = self.world.rng.choice(list(AUTO_HAZARDS))
        try:
            self.engine.trigger(name)
        except Exception:
            log.exception("auto hazard %s failed", name)

        # Busier site, shorter gaps; jittered so it never looks metronomic.
        base = AUTO_HAZARD_BASE_INTERVAL_S / intensity
        self._next_hazard_s = self.world.sim_time_s + self.world.rng.uniform(
            base * 0.5, base * 1.5
        )

    def _clear_auto_hazard(self) -> None:
        """Undo the previous auto hazard.

        Narrower than the `reset` scenario on purpose: machine overrides and
        belt state only. Weather, tasks and scenario hooks are left alone, so
        anything the operator set by hand survives the hazard loop.
        """
        world = self.world
        for machine in world.machines:
            machine.clear_overrides()
        for state in world._belt_state.values():
            state.clear()
        for name in list(world.active_scenarios):
            if name in AUTO_HAZARDS:
                world.active_scenarios.pop(name, None)

    async def step(self, dt: float = 1.0) -> None:
        self._auto_hazard()
        messages = self.world.tick(dt)
        await self.emitter.broadcast(messages)


def create_app(
    service: SimulatorService,
    lifespan: Callable[[FastAPI], AbstractAsyncContextManager[Any]] | None = None,
) -> FastAPI:
    app = FastAPI(title="CAT Copilot simulator", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],          # hackathon: every teammate's dev server
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.service = service

    # -- health / introspection -------------------------------------------
    @app.get("/health")
    def health() -> dict:
        w = service.world
        return {
            "ok": True,
            "mode": service.mode,
            "tick": w.tick_no,
            "sim_time_s": round(w.sim_time_s, 1),
            "machines": len(w.machines),
            "workers": len(w.workers),
            **service.emitter.status(),
        }

    @app.get("/state")
    def state() -> dict:
        return service.world.snapshot()

    @app.get("/site")
    def site() -> dict:
        return SITE_LAYOUT

    @app.get("/machines/{machine_id}")
    def machine(machine_id: str) -> dict:
        st = service.world.last_states.get(machine_id)
        if st is None:
            raise HTTPException(404, f"unknown machine {machine_id}")
        return st

    @app.get("/events")
    def events(limit: int = 50) -> list[dict]:
        return service.world.bus.history[-limit:]

    # -- tasks -------------------------------------------------------------
    @app.get("/tasks")
    def all_tasks() -> list[dict]:
        return service.world.tasks.all_tasks()

    @app.get("/tasks/{operator_id}")
    def operator_tasks(operator_id: str) -> list[dict]:
        tasks = service.world.tasks.for_operator(operator_id)
        if not tasks:
            raise HTTPException(404, f"no tasks for {operator_id}")
        return tasks

    @app.post("/tasks/{operator_id}/reorder")
    def reorder(operator_id: str, reason: str = "manual") -> dict:
        w = service.world
        if operator_id not in w.tasks.by_operator:
            raise HTTPException(404, f"no tasks for {operator_id}")
        payload = w.tasks.reorder(operator_id, reason)
        w.bus.emit(
            "task_reordered", "info",
            f"Tasks resequenced for {operator_id}",
            None, "simulator", payload, w.sim_time_s, force=True,
        )
        return payload

    # -- director ----------------------------------------------------------
    @app.get("/scenarios")
    def scenarios() -> list[dict]:
        return [
            {
                "name": s.name,
                "label": s.label,
                "description": s.description,
                "scripted": EMIT_SCRIPTED_EVENTS.get(s.name, True),
                "active": s.name in service.world.active_scenarios,
            }
            for s in SCENARIOS
        ]

    @app.post("/scenario/reset")
    def scenario_reset() -> dict:
        return service.engine.trigger("reset")

    @app.post("/scenario/{name}")
    async def scenario(name: str, params: dict | None = None) -> dict:
        result = service.engine.trigger(name, **(params or {}))
        if not result.get("ok"):
            raise HTTPException(404, result.get("error", "unknown scenario"))
        # push the scripted events straight out so the UI reacts on the click,
        # rather than on the next tick
        pending = service.world.bus.drain()
        if pending:
            await service.emitter.broadcast(pending)
        return result

    # -- live stream (standalone mode) ------------------------------------
    @app.websocket("/ws/live")
    async def ws_live(websocket: WebSocket) -> None:
        await websocket.accept()
        await service.broadcaster.register(websocket)
        try:
            # prime the new client with the current world so screens are never
            # blank while they wait for the next tick
            for st in service.world.last_states.values():
                await websocket.send_json(st)
            for st in service.world.last_worker_states.values():
                await websocket.send_json(st)
            while True:
                await websocket.receive_text()      # clients are read-only
        except WebSocketDisconnect:
            pass
        except Exception:
            pass
        finally:
            await service.broadcaster.unregister(websocket)

    return app
