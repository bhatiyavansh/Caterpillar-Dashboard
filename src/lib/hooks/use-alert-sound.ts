"use client";

/**
 * React side of `@/lib/alert-sound`: hand a screen's alert list to the hook and
 * anything new in it is audible.
 *
 * Each caller gets its own reporting key, so two screens watching different
 * slices of the same feed cannot talk over each other. Cross-source dedupe in
 * the util means an alert visible in three places is still one beep, and the
 * first list a caller reports primes it rather than playing — arriving on a
 * page with alerts already standing is silent.
 */
import * as React from "react";
import {
  announceAlerts,
  forgetAlertSource,
  unlockAlertSound,
  type SoundableAlert,
} from "@/lib/alert-sound";

export function useAlertSound(alerts: readonly SoundableAlert[] | undefined, label = "alerts"): void {
  const id = React.useId();
  const source = `${label}:${id}`;

  React.useEffect(() => {
    unlockAlertSound();
    return () => forgetAlertSource(source);
  }, [source]);

  React.useEffect(() => {
    if (!alerts) return;
    announceAlerts(alerts, source);
  }, [alerts, source]);
}
