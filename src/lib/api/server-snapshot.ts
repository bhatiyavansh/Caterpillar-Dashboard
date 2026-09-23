/**
 * The snapshot the server renders with.
 *
 * Without this, every screen would server-render a spinner and only fill in
 * after hydration — which during a demo reads as the product being slow. This
 * is the site at rest: real machines, real tasks, nothing alerting. React uses
 * it for the server pass and the hydration pass, then the live source takes
 * over on the first tick, so there is no mismatch.
 */
import type { SiteSnapshot } from "./contracts";
import { SHIFT_LABEL, seedMachines, seedTasks } from "./seed";

let cached: SiteSnapshot | null = null;

export function serverSnapshot(): SiteSnapshot {
  if (cached) return cached;

  const machines = seedMachines();
  const onSite = machines.filter((m) => m.status !== "offline");

  cached = {
    // Fixed so the server and the hydration pass agree.
    t: 0,
    clock: "--:--:--",
    shift: SHIFT_LABEL,
    weather: "clear",
    temperatureC: 34,
    machines,
    alerts: [],
    tasks: seedTasks(),
    kpis: {
      fleetSize: machines.length,
      active: onSite.filter((m) => m.status === "operating").length,
      atRisk: 0,
      openAlerts: 0,
      utilization: Math.round(onSite.reduce((s, m) => s + m.utilization, 0) / onSite.length),
      fuelUsedL: Math.round(machines.reduce((s, m) => s + m.fuelUsedL, 0) + 17_900),
    },
    riskScore: 14,
    activeScenario: null,
  };
  return cached;
}
