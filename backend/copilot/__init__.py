"""CAT Copilot hub (Person B).

Import bootstrap
----------------
`simulator` and `intelligence` live in the repo root package (`cat-copilot`), which uv
installs into this project's venv as an *editable* path dependency — a `.pth` file in
site-packages holding the repo root path.

On this project's macOS machines something re-applies the `UF_HIDDEN` file flag to the
venv's `.pth` files, and since 3.13 CPython's `site.py` **silently skips hidden .pth
files**. The editable install then evaporates with no warning and every entry point dies
with a bare `ModuleNotFoundError: No module named 'simulator'`, minutes after a green
test run, with nothing in the diff to explain it. `make unhide` clears the flag, but it
is a race: the flag can come back between the clear and the import.

So do not rely on the `.pth` at all. If `simulator` is not importable by the time this
package loads, put the repo root on `sys.path` ourselves. This is a no-op in a healthy
environment (the editable install wins, and the path is already there), and it keeps
uvicorn, pytest, hand-typed `uv run`, and the subprocesses the tests spawn all working.
"""

from __future__ import annotations

import sys
from importlib.util import find_spec
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent.parent


def _ensure_repo_importable() -> None:
    try:
        if find_spec("simulator") is not None:
            return
    except (ImportError, ValueError):
        pass  # a broken/partial entry: fall through and add the root ourselves
    root = str(REPO_DIR)
    if (REPO_DIR / "simulator" / "__init__.py").is_file() and root not in sys.path:
        sys.path.insert(0, root)


_ensure_repo_importable()
