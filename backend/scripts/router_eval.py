"""make router-eval: 25 labelled questions through the real router (rules; LLM only if ambiguous).
Prints a confusion table, accuracy and routing overhead. Without an LLM key, ambiguous questions fall
back to `general` - that is reported, not hidden."""

from __future__ import annotations

import asyncio
import statistics
import sys
from collections import Counter

import yaml

from copilot.agent.router import SPECIALISTS, Router
from copilot.agent.tools.definitions import build_registry
from copilot.config import BACKEND_DIR, load_dotenv

LABELS = [*SPECIALISTS, "general"]


async def evaluate(llm) -> dict:
    router = Router(llm, "fast", build_registry())
    cases = yaml.safe_load((BACKEND_DIR / "data" / "router_eval.yaml").read_text())["questions"]
    rows, times, by = [], [], Counter()
    for c in cases:
        r = await router.route(c["q"], "command")
        times.append(router.last_overhead_ms)
        by[r.routed_by] += 1
        rows.append((c["expect"], r.id, c["q"]))
    return {"rows": rows, "times": times, "by": by}


def report(res: dict) -> tuple[float, float]:
    confusion = Counter((e, g) for e, g, _ in res["rows"])
    w = 13
    print("expected \\ got".ljust(w) + "".join(label[:11].rjust(12) for label in LABELS))
    for e in LABELS:
        print(e.ljust(w) + "".join(str(confusion.get((e, g), 0) or ".").rjust(12) for g in LABELS))
    wrong = [(e, g, q) for e, g, q in res["rows"] if e != g]
    for e, g, q in wrong:
        print(f"  MISS expected={e} got={g}: {q}")
    acc = 1 - len(wrong) / len(res["rows"])
    ts = sorted(res["times"])
    p95 = ts[int(0.95 * (len(ts) - 1))]
    print(f"\naccuracy {acc:.0%} ({len(res['rows']) - len(wrong)}/{len(res['rows'])}); routed_by {dict(res['by'])}")
    print(f"overhead ms: median {statistics.median(ts):.2f}  p95 {p95:.2f}  max {ts[-1]:.2f}")
    return acc, p95


def main() -> int:
    load_dotenv()
    from copilot.agent.openai_compat import build_llm

    acc, p95 = report(asyncio.run(evaluate(build_llm())))
    return 0 if acc >= 0.9 and p95 < 300 else 1


if __name__ == "__main__":
    sys.exit(main())
