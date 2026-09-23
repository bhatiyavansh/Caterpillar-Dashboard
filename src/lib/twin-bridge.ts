"use client";

/**
 * Makes one director button move both worlds.
 *
 * The product screens read the fleet source; the 3D twin runs its own physics
 * engine. Neither should know about the other, so this is the single place that
 * says "worker proximity" means the same event in both. Without it, firing a
 * scenario would raise an alert in the command centre while the 3D site carried
 * on as though nothing had happened.
 *
 * Scenarios with no spatial meaning (an unbuckled belt, an idle anomaly) have
 * no twin action and are listed here explicitly so the mapping stays honest.
 */
import type { DirectorScenarioId } from "@/lib/api/contracts";
import { useTwinStore } from "@/store/twinStore";

export function applyScenarioToTwin(id: DirectorScenarioId): void {
  // Read through getState: this runs from an event handler, not a render.
  const twin = useTwinStore.getState();

  switch (id) {
    case "worker_proximity":
      twin.forceWorkerApproach();
      return;

    case "dozer_reversing":
      twin.forceCollisionRisk();
      return;

    case "heavy_lift_slope":
      twin.forceTipOver();
      return;

    case "hydraulic_spike":
      twin.forceHydraulicSpike();
      return;

    case "rain":
      twin.setWeather("rain");
      return;

    case "reset":
      twin.resetSimulation();
      twin.setWeather("clear");
      return;

    // No spatial equivalent — these live only in the product state.
    case "unbuckle":
    case "idle_anomaly":
      return;
  }
}
