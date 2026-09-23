"""Runtime settings, read once from the environment (prefix COPILOT_ unless noted)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


def _env(name: str, default: str) -> str:
    return os.environ.get(f"COPILOT_{name}", default)


@dataclass(frozen=True)
class Settings:
    host: str = "0.0.0.0"
    port: int = 8000
    db_path: Path = BACKEND_DIR / "data" / "copilot.db"
    snapshot_dir: Path = BACKEND_DIR / "data" / "cv_snapshots"
    sim_url: str = "http://localhost:8100"
    sim_timeout_s: float = 2.0

    heartbeat_s: float = 5.0
    ring_size: int = 10_000
    max_pending_reliable: int = 5_000
    slow_send_timeout_s: float = 5.0
    slow_progress_s: float = 1.0
    source_silence_s: float = 3.0
    stale_event_s: float = 30.0
    alert_ttl_s: float = 120.0

    persist_flush_s: float = 0.5
    persist_batch: int = 500
    persist_state_interval_s: float = 1.0

    control_ack_timeout_s: float = 2.0

    log_dir: Path = BACKEND_DIR / "logs"
    cache_dir: Path = BACKEND_DIR / "cache"
    llm_model: str = "claude-opus-5"
    llm_fast_model: str = "claude-haiku-4-5"
    llm_first_token_s: float = 5.0
    llm_total_s: float = 20.0
    ml_mode: str = "auto"  # auto | real | stub
    cors_origins: tuple[str, ...] = field(
        default=("http://localhost:3000", "http://127.0.0.1:3000")
    )

    def with_overrides(self, **kw) -> Settings:
        return replace(self, **kw)


def load_settings(**overrides) -> Settings:
    s = Settings(
        host=_env("HOST", "0.0.0.0"),
        port=int(_env("PORT", "8000")),
        db_path=Path(_env("DB_PATH", str(BACKEND_DIR / "data" / "copilot.db"))),
        sim_url=os.environ.get("SIMULATOR_URL", _env("SIM_URL", "http://localhost:8100")),
        heartbeat_s=float(_env("HEARTBEAT_S", "5")),
        ring_size=int(_env("RING_SIZE", "10000")),
        max_pending_reliable=int(_env("MAX_PENDING_RELIABLE", "5000")),
        slow_send_timeout_s=float(_env("SLOW_SEND_TIMEOUT_S", "5")),
        slow_progress_s=float(_env("SLOW_PROGRESS_S", "1")),
        source_silence_s=float(_env("SOURCE_SILENCE_S", "3")),
        log_dir=Path(_env("LOG_DIR", str(BACKEND_DIR / "logs"))),
        cache_dir=Path(_env("CACHE_DIR", str(BACKEND_DIR / "cache"))),
        llm_model=os.environ.get("LLM_MODEL", "claude-opus-5"),
        llm_fast_model=os.environ.get("LLM_FAST_MODEL", "claude-haiku-4-5"),
        ml_mode=os.environ.get("ML_MODE", "auto"),
        cors_origins=tuple(
            o.strip()
            for o in _env("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
            if o.strip()
        ),
    )
    return s.with_overrides(**overrides) if overrides else s
