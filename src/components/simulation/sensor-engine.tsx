"use client";

import { useEffect } from "react";
import { useMachineStore } from "@/store/machine-store";
import { useAlerts, useConnection, useMachine, useTasks } from "@/lib/hooks/use-site";
import { PRIMARY_MACHINE_ID } from "@/lib/api/seed";
import { hmiAlertId, toHmiAlert, toHmiOperator, toHmiTask } from "@/lib/hmi/live-mapping";

/**
 * Single global heartbeat for the in-cab HMI, and its bridge to the hub.
 *
 * Mounted once at the root so the dashboard and the in-cab app always read the
 * same values. While the hub is streaming the primary machine, every reading,
 * the seatbelt, the alert list, the task list and the operator card come from
 * it — the same site data `/cab` and `/command` render — and `tick()` stops
 * drifting whatever the hub supplies. When the hub drops, the local model takes
 * the gauges back and the HMI shows OFFLINE.
 */
export function SensorEngine() {
  const tick = useMachineStore((s) => s.tick);
  const applyLiveTelemetry = useMachineStore((s) => s.applyLiveTelemetry);
  const applyLiveAlerts = useMachineStore((s) => s.applyLiveAlerts);
  const applyLiveTasks = useMachineStore((s) => s.applyLiveTasks);
  const applyLiveOperator = useMachineStore((s) => s.applyLiveOperator);
  const applyLiveSeatbelt = useMachineStore((s) => s.applyLiveSeatbelt);
  const setBackendConnected = useMachineStore((s) => s.setBackendConnected);

  useEffect(() => {
    const id = window.setInterval(tick, 1200);
    return () => window.clearInterval(id);
  }, [tick]);

  const connection = useConnection();
  const { data: machine } = useMachine(PRIMARY_MACHINE_ID);
  const { data: alerts } = useAlerts({ machineId: PRIMARY_MACHINE_ID, includeAcknowledged: true });
  const { data: tasks } = useTasks(PRIMARY_MACHINE_ID);
  const backendLive = connection === "live" && machine !== null;

  useEffect(() => {
    setBackendConnected(backendLive);
  }, [backendLive, setBackendConnected]);

  // Readings.
  useEffect(() => {
    if (!backendLive || !machine) return;
    // Engine load has no sensor of its own; it is what rpm and payload imply,
    // both of which are real.
    const engineLoadPct =
      machine.engineRpm != null
        ? Math.round(Math.min(100, Math.max(0, ((machine.engineRpm - 800) / 1400) * 80 + machine.load * 0.2)))
        : undefined;
    applyLiveTelemetry({
      fuelPct: machine.fuel,
      hydraulicTemperature: machine.hydraulicTemperature,
      coolantTemperature: machine.coolantTemperature,
      speedKmh: machine.speedKmh,
      engineHours: machine.engineHours,
      engineRpm: machine.engineRpm ?? undefined,
      batteryPct: machine.batteryPct ?? undefined,
      defLevelPct: machine.defLevelPct ?? undefined,
      oilPressurePsi: machine.oilPressurePsi ?? undefined,
      hydraulicPressurePsi: machine.hydraulicPressurePsi ?? undefined,
      engineLoadPct,
    });
    if (machine.seatbelt !== "not_fitted") applyLiveSeatbelt(machine.seatbelt === "fastened");
  }, [backendLive, machine, applyLiveTelemetry, applyLiveSeatbelt]);

  // Alerts — the hub's, with the site protocol's first step as the action.
  useEffect(() => {
    if (!backendLive || !machine) return;
    const open = alerts.filter((a) => a.resolvedAt === null);
    const idMap: Record<string, string> = {};
    for (const a of open) idMap[hmiAlertId(a)] = a.id;
    applyLiveAlerts(
      open.map((a) => toHmiAlert(a, machine.model)),
      idMap,
    );
  }, [backendLive, machine, alerts, applyLiveAlerts]);

  // Tasks and the operator card.
  useEffect(() => {
    if (!backendLive || !machine) return;
    const assignee = machine.operator?.name ?? "Unassigned";
    applyLiveTasks(tasks.map((t) => toHmiTask(t, assignee)));
    const profile = useMachineStore.getState().operator;
    const operator = toHmiOperator(machine, tasks, alerts, profile);
    if (operator) applyLiveOperator(operator);
  }, [backendLive, machine, tasks, alerts, applyLiveTasks, applyLiveOperator]);

  return null;
}
