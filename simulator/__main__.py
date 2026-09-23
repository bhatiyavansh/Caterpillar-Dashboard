"""CLI entry point.

    uv run python -m simulator --mode standalone
    uv run python -m simulator --mode hub --hub ws://localhost:8000/ws/ingest
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import socket
import sys
from contextlib import asynccontextmanager

import uvicorn

from . import config
from .config import SEED, TICK_RATE_HZ
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
    p.add_argument("--rate", type=float, default=TICK_RATE_HZ,
                   help="ticks per second of wall clock (datapoints per second)")
    p.add_argument("--speed", type=float, default=1.0,
                   help="simulated seconds per wall second (1.0 = real time)")
    p.add_argument("--intensity", type=float, default=1.0,
                   help="how busy the site is; >1 puts more crew near machines")
    p.add_argument("--log-level", default="info")
    return p.parse_args(argv)


async def tick_loop(service: SimulatorService, rate: float, step_dt: float) -> None:
    """Fixed-cadence loop that never drifts and never stalls on a slow tick."""
    period = 1.0 / rate
    # A tick is "slow" relative to its own budget: at 60 Hz there are only
    # 16 ms to play with, so the 1 Hz threshold would never have fired.
    slow_threshold = max(period * 0.8, 0.005)
    loop = asyncio.get_running_loop()
    next_at = loop.time()
    slow_ticks = 0
    while True:
        started = loop.time()
        try:
            await service.step(dt=step_dt)
        except Exception:
            log.exception("tick failed; continuing")
        elapsed = loop.time() - started
        if elapsed > slow_threshold:
            slow_ticks += 1
            if slow_ticks % 600 == 1:
                log.warning("slow tick: %.0f ms", elapsed * 1000)
        next_at += period
        await asyncio.sleep(max(0.0, next_at - loop.time()))


def port_in_use(host: str, port: int) -> bool:
    probe_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex((probe_host, port)) == 0


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    logging.basicConfig(
        level=args.log_level.upper(),
        format="%(asctime)s %(levelname)-7s %(name)s  %(message)s",
    )

    # uvicorn's own "address already in use" is buried under a stack trace and
    # a misleading "simulator running" line, so check first and say it plainly
    if port_in_use(args.host, args.port):
        print(
            f"\nPort {args.port} is already in use - a simulator is probably "
            f"still running.\n\n"
            f"  Stop it:       pkill -f 'python -m simulator'\n"
            f"  Or use a different port:  --port {args.port + 1}\n",
            file=sys.stderr,
        )
        raise SystemExit(1)

    # Worker behaviour reads this at runtime, so the CLI can dial the site up.
    config.SITE_INTENSITY = args.intensity

    service = SimulatorService(seed=args.seed)
    service.mode = args.mode

    hub: HubClient | None = None
    if args.mode == "hub":
        hub = HubClient(args.hub)
        service.emitter = Emitter(service.broadcaster, hub)

    @asynccontextmanager
    async def lifespan(app):
        if hub is not None:
            hub.start()
        step_dt = args.speed / args.rate
        ticker = asyncio.create_task(
            tick_loop(service, args.rate, step_dt), name="tick"
        )
        log.info(
            "simulator running: mode=%s seed=%s rate=%.1f Hz  ws=ws://%s:%d/ws/live",
            args.mode, args.seed, args.rate, args.host, args.port,
        )
        try:
            yield
        finally:
            ticker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await ticker
            if hub is not None:
                await hub.stop()

    app = create_app(service, lifespan=lifespan)

    uvicorn.run(app, host=args.host, port=args.port, log_level=args.log_level)


if __name__ == "__main__":
    main()
