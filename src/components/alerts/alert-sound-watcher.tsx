"use client";

/**
 * Mounted once, app-wide: watches the alert feeds that outlive any single
 * screen, so an alert is heard on whichever page happens to be open.
 *
 * Three feeds cover the product:
 *  - the fleet source, behind every dashboard and command-centre screen;
 *  - the in-cab machine store's own alert list;
 *  - the advisories derived from live sensor values, which is how the cab
 *    raises something before an alert record exists.
 *
 * Screens that own an alert list the watcher cannot see — the 3D twin, or a
 * ribbon handed a bespoke list — call `useAlertSound` themselves. The dedupe in
 * `@/lib/alert-sound` keeps that from doubling up.
 */
import * as React from "react";
import { getFleetSource } from "@/lib/api";
import { deriveAdvice } from "@/lib/advice";
import { useMachineStore } from "@/store/machine-store";
import { announceAlerts, unlockAlertSound } from "@/lib/alert-sound";
import { useAlertSound } from "@/lib/hooks/use-alert-sound";

export function AlertSoundWatcher() {
  const machineAlerts = useMachineStore((s) => s.alerts);
  const sensors = useMachineStore((s) => s.sensors);

  // Info-level advice is ambient, not an alert; it stays silent.
  const advice = React.useMemo(
    () => deriveAdvice(sensors).filter((a) => a.severity !== "info"),
    [sensors],
  );

  useAlertSound(machineAlerts, "machine-store");
  useAlertSound(advice, "advice");

  React.useEffect(() => {
    unlockAlertSound();

    const source = getFleetSource();
    announceAlerts(source.getSnapshot().alerts, "fleet");
    return source.subscribe((snapshot) => announceAlerts(snapshot.alerts, "fleet"));
  }, []);

  return null;
}
