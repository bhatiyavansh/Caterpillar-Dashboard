"""FastAPI app factory: `uv run uvicorn --factory copilot.app:create_app` or `uv run python -m copilot`."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from copilot.api import director, live, rest
from copilot.api.stubs import register_stubs
from copilot.config import Settings, load_settings
from copilot.hub.hub import Hub
from copilot.sim_client import SimClient


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub = Hub(settings)
        app.state.hub = hub
        app.state.sim = SimClient(settings.sim_url, settings.sim_timeout_s)
        app.state.settings = settings
        await hub.start()
        try:
            yield
        finally:
            await hub.stop()
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
    register_stubs(app)
    return app
