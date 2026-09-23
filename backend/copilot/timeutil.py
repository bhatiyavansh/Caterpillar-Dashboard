from __future__ import annotations

import time
from datetime import UTC, datetime


def now_iso_ms(t: float | None = None) -> str:
    """ISO-8601 UTC with millisecond precision and a Z suffix."""
    dt = datetime.fromtimestamp(time.time() if t is None else t, tz=UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def now_iso_s(t: float | None = None) -> str:
    """Second precision, matching Person C's simulator format."""
    return datetime.fromtimestamp(time.time() if t is None else t, tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_ts(ts: str | None) -> float | None:
    """Parse the ISO strings used on the wire (with or without fraction, Z or offset)."""
    if not ts or not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None
