"""make rag-eval: every demo question must retrieve its expected source in the top 5 (hit@5 = 100%)."""

from __future__ import annotations

import sys

import yaml

from copilot.config import BACKEND_DIR
from copilot.knowledge.manuals import FastEmbedder, ManualIndex

EVAL = BACKEND_DIR / "data" / "rag_eval.yaml"


def run(index: ManualIndex) -> tuple[int, int, list[str]]:
    cases = yaml.safe_load(EVAL.read_text())["questions"]
    lines, hits = [], 0
    for c in cases:
        res = index.search(c["q"], k=5)
        got = [h["citation"] for h in res["hits"]]
        rank = next((i + 1 for i, cit in enumerate(got) if cit.startswith(c["expect"])), None)
        if c.get("expect_none"):
            ok = not res["found"]
        else:
            ok = rank is not None
        hits += ok
        lines.append(f"{'PASS' if ok else 'FAIL'}  rank={rank or '-'}  {c['q']}\n        expect {c.get('expect')}  got {got[:3]}")
    return hits, len(cases), lines


def main() -> int:
    try:
        embedder = FastEmbedder(BACKEND_DIR / "data" / "models")
    except Exception as exc:
        print(f"embedding model unavailable ({exc!r}); evaluating BM25 only")
        embedder = None
    index = ManualIndex.load(BACKEND_DIR / "data" / "index", embedder)
    hits, n, lines = run(index)
    print("\n".join(lines))
    print(f"\nhit@5 = {hits}/{n} = {hits / n:.0%}  ({index.provenance})")
    return 0 if hits == n else 1


if __name__ == "__main__":
    sys.exit(main())
