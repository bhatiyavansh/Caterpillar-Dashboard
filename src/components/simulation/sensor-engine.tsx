"use client";

import { useEffect } from "react";
import { useMachineStore } from "@/store/machine-store";

/**
 * Single global heartbeat that advances the mock sensor model. Mounted once at
 * the root so the dashboard and the in-cab app always read the same values.
 */
export function SensorEngine() {
  const tick = useMachineStore((s) => s.tick);

  useEffect(() => {
    const id = window.setInterval(tick, 1200);
    return () => window.clearInterval(id);
  }, [tick]);

  return null;
}
