"use client";

import { useEffect } from "react";
import { useMachineStore } from "@/store/machine-store";
import { useConnection, useMachine } from "@/lib/hooks/use-site";
import { PRIMARY_MACHINE_ID } from "@/lib/api/seed";

/**
 * Single global heartbeat that advances the mock sensor model. Mounted once at
 * the root so the dashboard and the in-cab app always read the same values.
 *
 * It also bridges the backend hub into that same model: whenever the hub is
 * actually streaming telemetry for the primary machine, real fuel,
 * temperature, speed and engine-hours values are overlaid on top of the local
 * drift (`applyLiveTelemetry`), and `tick()` stops drifting those fields so
 * the in-cab HMI shown inside the simulation stage stops being deaf to the
 * backend — the bug this fixes. Fields the hub contract does not carry (rpm,
 * battery, DEF, oil pressure) keep animating locally either way.
 */
export function SensorEngine() {
  const tick = useMachineStore((s) => s.tick);
  const applyLiveTelemetry = useMachineStore((s) => s.applyLiveTelemetry);
  const setBackendConnected = useMachineStore((s) => s.setBackendConnected);

  useEffect(() => {
    const id = window.setInterval(tick, 1200);
    return () => window.clearInterval(id);
  }, [tick]);

  const connection = useConnection();
  const { data: machine } = useMachine(PRIMARY_MACHINE_ID);
  const backendLive = connection === "live" && machine !== null;

  useEffect(() => {
    setBackendConnected(backendLive);
  }, [backendLive, setBackendConnected]);

  useEffect(() => {
    if (!backendLive || !machine) return;
    applyLiveTelemetry({
      fuelPct: machine.fuel,
      hydraulicTemperature: machine.hydraulicTemperature,
      coolantTemperature: machine.coolantTemperature,
      speedKmh: machine.speedKmh,
      engineHours: machine.engineHours,
    });
  }, [backendLive, machine, applyLiveTelemetry]);

  return null;
}
