"""Markdown documents with a YAML frontmatter block (--- ... ---)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def read(path: Path) -> tuple[dict[str, Any], str, str]:
    """Returns (metadata, body, raw file text)."""
    raw = path.read_text(encoding="utf-8")
    if not raw.startswith("---\n"):
        return {}, raw, raw
    end = raw.index("\n---", 4)
    meta = yaml.safe_load(raw[4:end]) or {}
    body = raw[end + 4:].lstrip("\n")
    return meta, body, raw
