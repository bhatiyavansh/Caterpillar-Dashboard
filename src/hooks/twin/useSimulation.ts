"use client";

/**
 * The frame driver.
 *
 * Runs at negative priority so the engine has already advanced before any 3D
 * component reads telemetry this frame. Negative priorities sort first without
 * taking over R3F's render loop (only `priority > 0` does that).
 *
 * The HUD is refreshed on a throttle rather than every frame — sixty React
 * renders a second would cost far more than the simulation itself, and
 * telemetry digits are unreadable at that rate anyway.
 */

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { readInput } from "@/lib/twin/controls";
import { useTwinStore } from "@/store/twinStore";

/** Seconds between HUD refreshes (~12 Hz). */
const REFRESH_INTERVAL = 1 / 12;

/**
 * Exactly one driver may advance the shared engine.
 *
 * Two stages can be alive at once — /simulation renders one inside the in-cab
 * frame while the global SimulationHost can mount another — and both keep
 * running `useFrame` even when hidden. Without this token they would each call
 * `step()`, running the site at double speed.
 */
let driverToken: object | null = null;

export function useSimulation(): void {
  const sinceRefresh = useRef(0);
  const token = useRef({});

  useEffect(() => {
    const self = token.current;
    if (!driverToken) driverToken = self;
    return () => {
      if (driverToken === self) driverToken = null;
    };
  }, []);

  useFrame((_, delta) => {
    if (driverToken !== token.current) return;
    const engine = useTwinStore.getState().engine;

    // Guard against enormous deltas after the tab has been in the background.
    const dt = Math.min(delta, 0.05);

    engine.step(dt, readInput(dt));

    sinceRefresh.current += delta;
    if (sinceRefresh.current >= REFRESH_INTERVAL) {
      sinceRefresh.current = 0;
      useTwinStore.getState().refresh();
    }
  }, -1);
}

/** Mount this as the first child of the Canvas. */
export function SimulationDriver() {
  useSimulation();
  return null;
}
