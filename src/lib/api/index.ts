/**
 * Single entry point for site data.
 *
 * Live by default: the product talks to the FastAPI hub (http://localhost:8000
 * unless `NEXT_PUBLIC_API_URL` says otherwise) through the one shared stream
 * client, and falls back to the simulated baseline per panel when the hub has
 * not sent that data yet. Set `NEXT_PUBLIC_USE_MOCK=1` to force the pure mock —
 * useful for design work and for demoing with no backend running.
 *
 * Every screen behaves identically either way; no component imports a concrete
 * source.
 */
import type { FleetSource } from "./source";
import { MockFleetSource } from "./mock-source";
import { LiveFleetSource } from "./live-source";
import type { DirectorScenario, DirectorScenarioId } from "./contracts";

let instance: FleetSource | null = null;

export function getFleetSource(): FleetSource {
  if (instance) return instance;

  const forceMock = process.env.NEXT_PUBLIC_USE_MOCK === "1";
  instance = forceMock ? new MockFleetSource() : new LiveFleetSource();
  instance.start();
  return instance;
}

/**
 * Director adapter. Screens call `directorApi.triggerScenario("rain")` and
 * never learn whether that became a POST or a local simulation change.
 */
export const directorApi = {
  triggerScenario: (id: DirectorScenarioId) => getFleetSource().triggerScenario(id),
  scenarios: (): DirectorScenario[] => DIRECTOR_SCENARIOS,
};

export const DIRECTOR_SCENARIOS: DirectorScenario[] = [
  {
    id: "unbuckle",
    label: "Unbuckle seatbelt",
    group: "Safety",
    description: "EXC001 restraint opens. Warns, then escalates to a travel lock after 12 s.",
    watchOn: "/cab",
    holdSeconds: 0,
  },
  {
    id: "worker_proximity",
    label: "Worker behind machine",
    group: "Safety",
    description: "A spotter walks into the rear blind spot of EXC001 and back out again.",
    watchOn: "/command",
    holdSeconds: 26,
  },
  {
    id: "dozer_reversing",
    label: "Dozer reversing",
    group: "Operations",
    description: "DOZ001 reverses toward EXC001. V2V predicts a 3.2 s conflict.",
    watchOn: "/command",
    holdSeconds: 22,
  },
  {
    id: "heavy_lift_slope",
    label: "Heavy lift on slope",
    group: "Operations",
    description: "EXC001 lifts at full reach on a cross-slope. Stability margin falls to 1.14.",
    watchOn: "/cab",
    holdSeconds: 0,
  },
  {
    id: "rain",
    label: "Rain incoming",
    group: "Environment",
    description: "Weather turns. Tasks re-sequence and the working-conditions risk score rises.",
    watchOn: "/cab",
    holdSeconds: 0,
  },
  {
    id: "hydraulic_spike",
    label: "Hydraulic temperature spike",
    group: "Machine health",
    description: "EXC002 hydraulic oil climbs past 105 °C and drafts a work order.",
    watchOn: "/owner",
    holdSeconds: 0,
  },
  {
    id: "idle_anomaly",
    label: "Inject idle anomaly",
    group: "Anomalies",
    description: "Belt-off plus high idle on EXC002 surfaces in the owner portal with a fuel cost.",
    watchOn: "/owner",
    holdSeconds: 0,
  },
  {
    id: "reset",
    label: "Reset demo",
    group: "System",
    description: "Clears every scenario and returns the site to its nominal opening state.",
    watchOn: "/command",
    holdSeconds: 0,
    destructive: true,
  },
];

export type { FleetSource };
export * from "./contracts";
