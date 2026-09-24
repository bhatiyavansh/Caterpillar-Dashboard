"use client";

/**
 * Takes the machine off the live feed and gives it to the keyboard.
 *
 * Training needs this. In live mode the engine's `stepLive()` writes position,
 * heading and every joint angle onto the machine from the socket sixty times a
 * second. The learner's keypresses are integrated by the `VehicleModel` and
 * then immediately overwritten, so the machine never moves, every lesson step
 * times out, and the coach concludes the learner cannot drive.
 *
 * A lesson has to own the machine. This hook forces the keyboard source while
 * it is enabled and hands control back when it unmounts.
 *
 * It disconnects the *client link*, not the simulator: other screens may be
 * reading the same backend, and a training session has no business stopping a
 * shared service. `engine.setSource()` closes the socket cleanly on its own.
 */

import { useEffect } from "react";
import { useTwinStore } from "@/store/twinStore";

export function useLocalControl(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    // Going through the store rather than the engine sets `sourceLocked`, so a
    // live-link probe already in flight cannot switch us back a moment later.
    useTwinStore.getState().setSource("keyboard");

    return () => {
      // Release the lock so the probe may reattach on screens that want live
      // data. We deliberately do not restore the previous source by hand —
      // that would race the probe, which already does the right thing.
      useTwinStore.getState().releaseSourceLock();
    };
  }, [enabled]);
}
