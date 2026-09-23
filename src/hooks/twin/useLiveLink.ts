"use client";

/**
 * Auto-attaches the twin to the live hub when one is reachable.
 *
 * The twin has to work in two situations that pull in opposite directions:
 * on a laptop with the whole stack running, the live feed should just be on;
 * on a laptop with only `npm run dev`, the demo must still open and be
 * drivable. So rather than defaulting to one or the other, it asks.
 *
 * A short health probe decides. If the hub answers, the source switches to the
 * shared stream; if not, the twin stays on the keyboard and says nothing. The
 * operator can override either way at any time, and once they do, this stops
 * interfering.
 *
 * It probes the hub (:8000), not the simulator (:8100), because the hub is what
 * the twin now reads — see `lib/twin/websocketProvider.ts`.
 */

import { useEffect } from "react";
import { apiBase } from "@web/lib/stream";
import { useTwinStore } from "@/store/twinStore";

/** How long to wait for the hub before giving up and staying local. */
const PROBE_TIMEOUT_MS = 1200;

export function useLiveLink(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    (async () => {
      try {
        const response = await fetch(`${apiBase()}/api/health`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;

        // The hub reports its sources; with none attached there is nothing to show,
        // so the self-contained demo is still the better default.
        const health = (await response.json()) as { sources?: unknown[] };
        if (cancelled || !Array.isArray(health?.sources) || health.sources.length === 0) return;

        // Only take over if the operator has not already chosen a source.
        const store = useTwinStore.getState();
        if (store.sourceLocked) return;

        store.setSource("websocket", { auto: true });
      } catch {
        // No hub, a timeout, or CORS — all mean the same thing here:
        // run the self-contained demo. Silent by design.
      } finally {
        clearTimeout(timer);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled]);
}
