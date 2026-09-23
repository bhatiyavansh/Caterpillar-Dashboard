"use client";

import * as React from "react";
import type { SensorData } from "@/lib/types";
import { useMachineStore } from "./machine-store";

export interface HistoryPoint {
  t: string;
  temp: number;
  psi: number;
  rpm: number;
}

function point(s: SensorData): HistoryPoint {
  return {
    t: new Date().toLocaleTimeString("en-GB", { minute: "2-digit", second: "2-digit" }),
    temp: Number(s.engineTemperature.toFixed(1)),
    psi: Math.round(s.hydraulicPressure),
    rpm: Math.round(s.rpm),
  };
}

/**
 * Rolling window of recent sensor samples, fed by the store's own subscription
 * rather than a render-triggered effect.
 */
export function useSensorHistory(length = 40) {
  const [history, setHistory] = React.useState<HistoryPoint[]>(() => [point(useMachineStore.getState().sensors)]);

  React.useEffect(
    () =>
      useMachineStore.subscribe((state, prev) => {
        if (state.sensors === prev.sensors) return;
        setHistory((h) => [...h, point(state.sensors)].slice(-length));
      }),
    [length],
  );

  return history;
}
