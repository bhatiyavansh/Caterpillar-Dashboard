"""FastAPI app factory: `uv run uvicorn --factory copilot.app:create_app` or `uv run python -m copilot`."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from copilot.agent.confirm import ActionManager
from copilot.agent.llm import AnthropicLLM
from copilot.agent.loop import Agent, AgentSettings
from copilot.agent.registry import ToolContext
from copilot.agent.tools.definitions import build_registry
from copilot.api import assistant, director, live, rest
from copilot.api.stubs import register_stubs
from copilot.config import Settings, load_settings
from copilot.contracts.assistant import AssistantRequest
from copilot.hub.hub import Hub
from copilot.ml.auto import AutoML
from copilot.ml.jobs import WhatIfJobs
from copilot.records.store import RecordStore
from copilot.sim_client import SimClient


def create_app(settings: Settings | None = None, llm=None, ml=None) -> FastAPI:
    """`llm` / `ml` injection is for tests (FakeLLM, StubML); production builds the real ones."""
    settings = settings or load_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub = Hub(settings)
        app.state.hub = hub
        app.state.sim = SimClient(settings.sim_url, settings.sim_timeout_s)
        app.state.settings = settings
        await hub.start()
        records = RecordStore(settings.db_path)
        await records.start()
        ml_port = ml or AutoML(settings.ml_mode)
        jobs = WhatIfJobs(ml_port, settings.cache_dir)
        actions = ActionManager(hub)
        registry = build_registry()
        extras: dict = {}

        def context_factory(req_or_surface) -> ToolContext:
            req = req_or_surface if isinstance(req_or_surface, AssistantRequest) else AssistantRequest(
                surface=req_or_surface, message="(confirm)")
            return ToolContext(hub=hub, sim=app.state.sim, ml=ml_port, records=records, actions=actions, jobs=jobs,
                               surface=req.surface, machine_id=req.machine_id, operator_id=req.operator_id,
                               extras=extras)

        actions.registry, actions.context_factory = registry, context_factory
        llm_port = llm or AnthropicLLM()
        agent = Agent(llm_port, registry, hub, context_factory, AgentSettings(
            model=settings.llm_model, fast_model=settings.llm_fast_model, first_token_s=settings.llm_first_token_s,
            total_s=settings.llm_total_s, log_path=settings.log_dir / "turns.jsonl"))
        app.state.records, app.state.ml, app.state.jobs, app.state.actions = records, ml_port, jobs, actions
        app.state.registry, app.state.context_factory, app.state.agent, app.state.extras = (
            registry, context_factory, agent, extras)
        hub.feature_flags.update(llm="live" if llm_port.available else "down (no ANTHROPIC_API_KEY)",
                                 ml=getattr(ml_port, "name", "custom"))
        warm = getattr(getattr(ml_port, "real", None), "warm", None)
        if warm is not None:
            asyncio.create_task(warm())
        try:
            yield
        finally:
            await hub.stop()
            await records.stop()
            await app.state.sim.close()

    app = FastAPI(title="CAT Copilot hub", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Stub"],
    )
    app.include_router(live.router)
    app.include_router(rest.router)
    app.include_router(director.router)
    app.include_router(assistant.router)
    register_stubs(app)
    return app
