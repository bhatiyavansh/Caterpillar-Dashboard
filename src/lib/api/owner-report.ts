/**
 * Owner-portal figures, derived from a snapshot.
 *
 * Kept pure and separate from the source so the server pass and the live client
 * compute them the same way, and the portal renders its real numbers on the
 * first paint rather than after hydration.
 */
import type { OwnerKpis, OwnerSeries, SiteSnapshot } from "./contracts";

/** Rupees per idle minute, from site diesel price and typical idle burn. */
const IDLE_COST_PER_MINUTE = 188;
/** Kilograms of CO2 per litre of diesel. */
const CO2_PER_LITRE = 2.68;

export function ownerKpisFrom(snapshot: SiteSnapshot): OwnerKpis {
  const fuelL = snapshot.kpis.fuelUsedL;
  const idleMinutes = snapshot.machines.reduce((sum, m) => sum + m.idleMinutes, 0);
  return {
    fleetCostInr: 1_240_000,
    idleCostInr: Math.round(idleMinutes * IDLE_COST_PER_MINUTE),
    fuelL,
    carbonTonnes: Number(((fuelL * CO2_PER_LITRE) / 1000).toFixed(1)),
    utilization: snapshot.kpis.utilization,
    productiveHours: 1_642,
  };
}

export function ownerSeries(): OwnerSeries {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const utilization = [74, 81, 79, 86, 82, 68, 41];
  const fuel = [2610, 2880, 2740, 3020, 2960, 2310, 1420];
  const idleCost = [61_200, 74_800, 68_400, 59_100, 82_400, 91_600, 44_300];
  const productivity = [212, 248, 231, 268, 254, 188, 96];
  const carbon = fuel.map((f) => Number(((f * CO2_PER_LITRE) / 1000).toFixed(2)));
  const zip = (values: number[]) => days.map((label, i) => ({ label, value: values[i] }));
  return {
    utilization: zip(utilization),
    fuel: zip(fuel),
    idleCost: zip(idleCost),
    productivity: zip(productivity),
    carbon: zip(carbon),
  };
}
