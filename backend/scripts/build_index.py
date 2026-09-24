"""make index: build the manual RAG index (downloads the small embedding model once, then offline)."""

from __future__ import annotations

import sys
import time

from copilot.config import BACKEND_DIR
from copilot.knowledge.manuals import FastEmbedder, ManualIndex, corpus_dirs

DATA = BACKEND_DIR / "data"
INDEX = BACKEND_DIR / "data" / "index"
MODELS = BACKEND_DIR / "data" / "models"


def main() -> int:
    t0 = time.time()
    try:
        embedder = FastEmbedder(MODELS, download=True)
    except Exception as exc:  # network down on first run, etc.
        print(f"embedding model unavailable ({exc!r}); building a BM25-only index", file=sys.stderr)
        embedder = None
    dirs = corpus_dirs(DATA)
    idx = ManualIndex.build(dirs, embedder)
    idx.save(INDEX)
    synthetic = sum(c.synthetic for c in idx.chunks)
    print(f"indexed {len(idx.chunks)} chunks ({synthetic} synthetic) from "
          f"{', '.join(str(d.relative_to(BACKEND_DIR)) for d in dirs)} "
          f"with {idx.embedder_name or 'no embeddings'} in {time.time() - t0:.1f}s -> {INDEX.relative_to(BACKEND_DIR)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
