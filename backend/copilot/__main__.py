"""`uv run python -m copilot [--port 8000]` — starts the hub, failing clearly if the port is taken."""

from __future__ import annotations

import argparse
import socket
import sys

import uvicorn

from copilot.app import create_app
from copilot.config import load_settings


def main() -> int:
    p = argparse.ArgumentParser(prog="copilot")
    p.add_argument("--host", default=None)
    p.add_argument("--port", type=int, default=None)
    args = p.parse_args()
    overrides = {k: v for k, v in (("host", args.host), ("port", args.port)) if v is not None}
    settings = load_settings(**overrides)
    with socket.socket() as s:
        # Same flag uvicorn uses: lets us rebind while old connections sit in TIME_WAIT after a restart.
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((settings.host, settings.port))
        except OSError:
            print(f"port {settings.port} is already in use; is another hub running?", file=sys.stderr)
            return 1
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
