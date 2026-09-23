"""CLI entry point.

    uv run python -m simulator --mode standalone
    uv run python -m simulator --mode hub --hub ws://localhost:8000/ws/ingest
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging

import uvicorn

from .config import SEED
from .control_api import SimulatorService, create_app
from .emitter import Emitter, HubClient

log = logging.getLogger("simulator")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="simulator", description="CAT Copilot site simulator")
    p.add_argument("--mode", choices=("standalone", "hub"), default="standalone",
                   help="standalone serves its own WS on :8100/ws/live; "
                        "hub also pushes into B's /ws/ingest")
    p.add_argument("--hub", default="ws://localhost:8000/ws/ingest",
                   help="hub ingest URL (mode=hub)")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8100)
    p.add_argument("--seed", type=int, default=SEED)
    p.add_argument("--rate", type=float, default=1.0,
                   help="ticks per second of wall clock (1.0 = real time)")
    p.add_argument("--log-level", default="info")
    return p.parse_args(argv)


async def tick_loop(service: SimulatorService, rate: float) -> None:
    """Fixed-cadence loop that never drifts and never stalls on a slow tick."""
    period = 1.0 / rate
    loop = asyncio.get_running_loop()
    next_at = loop.time()
    slow_ticks = 0
    while True:
        started = loop.time()
        try:
            await service.step(dt=1.0)
        except Exception:
            log.exception("tick failed; continuing")
        elapsed = loop.time() - started
        if elapsed > 0.05:
            slow_ticks += 1
            if slow_ticks % 20 == 1:
                log.warning("slow tick: %.0f ms", elapsed * 1000)
        next_at += period
        await asyncio.sleep(max(0.0, next_at - loop.time()))


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
    )

    service = SimulatorService(seed=args.seed)
    service.mode = args.mode

    hub: HubClient | None = None
    if args.mode == "hub":
        hub = HubClient(args.hub)
        service.emitter = Emitter(service.broadcaster, hub)

    app = create_app(service)

    @app.on_event("startup")
    async def _startup() -> None:
        if hub is not None:
            hub.start()
        app.state.ticker = asyncio.create_task(tick_loop(service, args.rate), name="tick")
        log.info(
            "simulator running: mode=%s seed=%s rate=%.1f Hz  ws=ws://%s:%d/ws/live",
            args.mode, args.seed, args.rate, args.host, args.port,
        )

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        task = getattr(app.state, "ticker", None)
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        if hub is not None:
            await hub.stop()

    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)


if __name__ == "__main__":
    main()
