"""FastAPI app factory: `uv run uvicorn --factory copilot.app:create_app` or `uv run python -m copilot`."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from copilot.agent.confirm import ActionManager
from copilot.agent.loop import Agent, AgentSettings
from copilot.agent.openai_compat import build_llm
from copilot.agent.registry import ToolContext
from copilot.agent.router import Router
from copilot.agent.tools.definitions import build_registry
from copilot.api import assistant, director, knowledge, live, rest
from copilot.api.stubs import register_stubs
from copilot.config import Settings, load_settings
from copilot.contracts.assistant import AssistantRequest
from copilot.hub.hub import Hub
from copilot.knowledge.manuals import FastEmbedder, ManualIndex, corpus_text
from copilot.knowledge.protocols import ProtocolLibrary
from copilot.ml.auto import AutoML
from copilot.ml.jobs import WhatIfJobs
from copilot.records.store import RecordStore
from copilot.reports.service import Reports
from copilot.sim_client import SimClient


def load_rag(data_dir, embedder_factory=None):
    """Committed index (make index) if present, else an in-memory BM25-only index - labelled either way."""
    index_dir = data_dir / "index"
    embedder = None
    if embedder_factory is not None:
        try:
            embedder = embedder_factory()
        except Exception as exc:  # model not downloaded yet / offline first run
            logging.getLogger("copilot.rag").warning("embedding model unavailable (%r): BM25 only", exc)
    if (index_dir / "chunks.json").exists():
        return ManualIndex.load(index_dir, embedder)
    return ManualIndex.build(data_dir / "manuals", None)


def create_app(settings: Settings | None = None, llm=None, ml=None, embedder_factory="default",
               router="default") -> FastAPI:
    """`llm` / `ml` / `embedder_factory` injection is for tests; production builds the real ones."""
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
        data_dir = settings.data_dir
        protocols = ProtocolLibrary.load(data_dir / "protocols", corpus_text(data_dir / "manuals"))  # refuses bad libraries
        hub.event_enrichers.append(protocols.enrich)
        if embedder_factory == "default":
            factory = (lambda: FastEmbedder(data_dir / "models")) if settings.rag_embeddings else None
        else:
            factory = embedder_factory
        rag = await asyncio.to_thread(load_rag, data_dir, factory)
        extras: dict = {"protocols": protocols, "rag": rag, "snapshot_dir": settings.snapshot_dir}

        def context_factory(req_or_surface) -> ToolContext:
            req = req_or_surface if isinstance(req_or_surface, AssistantRequest) else AssistantRequest(
                surface=req_or_surface, message="(confirm)")
            return ToolContext(hub=hub, sim=app.state.sim, ml=ml_port, records=records, actions=actions, jobs=jobs,
                               surface=req.surface, machine_id=req.machine_id, operator_id=req.operator_id,
                               extras=extras)

        actions.registry, actions.context_factory = registry, context_factory
        llm_port = llm or build_llm()
        reports = Reports(hub, llm_port, settings.llm_fast_model, protocols, records, ml_port, settings.cache_dir,
                          first_token_s=settings.llm_first_token_s, total_s=max(settings.llm_total_s, 2.0))
        extras.update(reports=reports, llm=llm_port, vision_model=settings.llm_model)
        agent = Agent(llm_port, registry, hub, context_factory, AgentSettings(
            model=settings.llm_model, fast_model=settings.llm_fast_model, first_token_s=settings.llm_first_token_s,
            total_s=settings.llm_total_s, log_path=settings.log_dir / "turns.jsonl"),
            router=Router(llm_port, settings.llm_fast_model, registry) if router == "default" else router)
        app.state.records, app.state.ml, app.state.jobs, app.state.actions = records, ml_port, jobs, actions
        app.state.registry, app.state.context_factory, app.state.agent, app.state.extras = (
            registry, context_factory, agent, extras)
        app.state.protocols, app.state.reports = protocols, reports
        hub.feature_flags.update(llm=f"live ({llm_port.name})" if llm_port.available else "down (no LLM key)",
                                 ml=getattr(ml_port, "name", "custom"), rag=rag.provenance,
                                 protocols=str(len(protocols.protocols)))
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
    app.include_router(knowledge.router)
    register_stubs(app)
    return app
