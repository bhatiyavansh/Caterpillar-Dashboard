"use client";

/**
 * Wires the keyboard to the store.
 *
 * Mounted once by the page, OUTSIDE the Canvas. No 3D component ever listens
 * for a key — they only ever read telemetry.
 */

import { useEffect } from "react";
import { attachControls } from "@/lib/twin/controls";
import { useTwinStore } from "@/store/twinStore";

export function useVehicleControls(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    // Pulled from the store imperatively so the listeners attach exactly once
    // and never churn on re-render.
    const { toggleEmergencyStop, resetMachine, toggleDirector, toggleHelp } =
      useTwinStore.getState();

    return attachControls({
      onEmergencyStop: toggleEmergencyStop,
      onReset: resetMachine,
      onToggleDirector: toggleDirector,
      onToggleHelp: toggleHelp,
    });
  }, [enabled]);
}
