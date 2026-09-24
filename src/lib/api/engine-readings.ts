/**
 * Engine and hydraulic readings for the simulated baseline (contract 1.4.0).
 *
 * Mirrors `_update_engine` in `simulator/machine.py`, so a screen running on the
 * offline mock moves the same way it does on the live feed: rpm and pressures
 * follow the work, oil pressure follows rpm and sags when hot. When the hub is
 * streaming, `live-source.ts` overlays the simulator's real values on top.
 */

export interface EngineTargets {
  engineRpm: number;
  oilPressurePsi: number;
  hydraulicPressurePsi: number;
}

export function engineTargets(input: {
  engineOn: boolean;
  /** 0-1: how hard the machine is working (or travelling). */
  effort: number;
  /** 0-1: payload as a share of rated payload. */
  loadRatio: number;
  coolantC: number;
  /** Extra hydraulic heat from a scenario, °C. Raises circuit pressure. */
  hydraulicOffsetC?: number;
}): EngineTargets {
  if (!input.engineOn) return { engineRpm: 0, oilPressurePsi: 0, hydraulicPressurePsi: 0 };

  const effort = Math.min(Math.max(input.effort, 0), 1);
  const load = Math.min(Math.max(input.loadRatio, 0), 1);

  const engineRpm = Math.min(850 + 900 * effort + 250 * load, 2200);
  // Normal work stays under the HMI's 3,400 psi warning; only extra heat
  // (the hydraulic-spike scenario) pushes it past the 3,650 psi critical.
  let hydraulicPressurePsi = 700 + 2100 * effort + 450 * load;
  hydraulicPressurePsi += Math.max(input.hydraulicOffsetC ?? 0, 0) * 25;
  hydraulicPressurePsi = Math.min(hydraulicPressurePsi, 4800);

  let oil = 22 + 40 * (engineRpm / 2200);
  oil -= Math.max(input.coolantC - 92, 0) * 0.8;
  const oilPressurePsi = Math.min(Math.max(oil, 10), 70);

  return { engineRpm, oilPressurePsi, hydraulicPressurePsi };
}
