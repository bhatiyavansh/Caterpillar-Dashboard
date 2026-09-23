"use client";

/**
 * Auto-attaches the twin to the live simulator when one is reachable.
 *
 * The twin has to work in two situations that pull in opposite directions:
 * on a laptop with the whole stack running, the live feed should just be on;
 * on a laptop with only `npm run dev`, the demo must still open and be
 * drivable. So rather than defaulting to one or the other, it asks.
 *
 * A short health probe decides. If the simulator answers, the source switches
 * to the socket; if not, the twin stays on the keyboard and says nothing. The
 * operator can override either way at any time, and once they do, this stops
 * interfering.
 */

import { useEffect } from "react";
import { useTwinStore } from "@/store/twinStore";

/** Derived from the socket URL so both point at the same simulator. */
function healthUrl(): string {
  const ws = process.env.NEXT_PUBLIC_TWIN_WS_URL ?? "ws://localhost:8100/ws/live";
  try {
    const url = new URL(ws);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = "/health";
    return url.toString();
  } catch {
    return "http://localhost:8100/health";
  }
}

/** How long to wait for the simulator before giving up and staying local. */
const PROBE_TIMEOUT_MS = 1200;

export function useLiveLink(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

    (async () => {
      try {
        const response = await fetch(healthUrl(), {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) return;

        const health = (await response.json()) as { ok?: boolean; machines?: number };
        if (cancelled || !health?.ok) return;

        // Only take over if the operator has not already chosen a source.
        const store = useTwinStore.getState();
        if (store.sourceLocked) return;

        store.setSource("websocket", { auto: true });
      } catch {
        // No simulator, a timeout, or CORS — all mean the same thing here:
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
