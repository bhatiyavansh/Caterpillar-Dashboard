/**
 * Scenario definition format.
 *
 * A physics scenario is data: which machines it takes over, how the site is
 * set up, and a list of steps, each waiting for a trigger and then applying
 * actions. The runner (`runner.ts`) interprets it against the live engine;
 * the physics world decides what actually happens. New real-world scenarios
 * are added to `library.ts` without touching the engine or the runner.
 *
 * Angles are degrees and distances metres throughout, so definitions read
 * the way a site engineer would write them.
 */

import type { WeatherMode } from "@/types/twin";

export type Condition =
  /** Seconds since the step began. */
  | { kind: "elapsed"; s: number }
  /** Bench face C has let go. */
  | { kind: "faceFailed" }
  /** Two machines' hulls are touching. */
  | { kind: "contact"; a: string; b: string }
  /** The machine has gone past its tipping point. */
  | { kind: "tipped"; machine: string }
  /** Body tilt from vertical exceeds `deg`. */
  | { kind: "tiltAbove"; machine: string; deg: number }
  /** The stability display metric has fallen below `value`. */
  | { kind: "marginBelow"; machine: string; value: number }
  /** Traction loss above `above` (0..1). */
  | { kind: "slipping"; machine: string; above?: number }
  /** Moved at least `metres` backwards (against its heading) since `mark`. */
  | { kind: "rolledBack"; machine: string; metres: number }
  /** Within `within` metres of a point. */
  | { kind: "near"; machine: string; x: number; z: number; within: number }
  /** Speed below 0.1 m/s. */
  | { kind: "stopped"; machine: string }
  /** The machine's arm has reached its commanded pose. */
  | { kind: "armSettled"; machine: string }
  | { kind: "any"; of: Condition[] }
  | { kind: "all"; of: Condition[] };

export type Action =
  | { kind: "weather"; mode: WeatherMode }
  /** Set how soaked the ground already is (0..1) instead of waiting for rain to soak in. */
  | { kind: "soak"; level: number }
  /** Put a machine somewhere, settled on the ground, stopped. */
  | { kind: "place"; machine: string; x: number; z: number; heading: number; payload?: number }
  /** Hydraulics: drive the arm toward these joint angles at the machine's normal rates. */
  | { kind: "arm"; machine: string; boom?: number; stick?: number; bucket?: number; swing?: number }
  /** Operator input held until the next drive action. */
  | { kind: "drive"; machine: string; throttle: number; steer?: number }
  /** Drive to a point (forwards, or backing in). */
  | { kind: "driveTo"; machine: string; x: number; z: number; cruise?: number; reverse?: boolean }
  /** Throttle off, brakes on. */
  | { kind: "stop"; machine: string }
  /** Hand the machine back to its normal AI (or the operator). */
  | { kind: "release"; machine: string }
  | { kind: "payload"; machine: string; kg: number }
  /** V2V braking on or off for this machine. */
  | { kind: "avoidance"; machine: string; on: boolean }
  | { kind: "releaseFace" }
  | { kind: "pour"; x: number; z: number; tonnes: number; height?: number }
  /** Stand the spotter beside the primary machine. */
  | { kind: "worker"; side: "front" | "rear" | "left" | "right"; distance: number }
  /** Record the machine's position (for `rolledBack`). */
  | { kind: "mark"; machine: string }
  | { kind: "event"; text: string; severity?: "info" | "warning" | "critical" }
  | { kind: "end" };

export interface Step {
  label: string;
  /** Default: run immediately. */
  when?: Condition;
  do: Action[];
}

/** Something the scenario is expected to demonstrate, checked continuously. */
export interface Expectation {
  label: string;
  when: Condition;
}

export interface PhysicsScenario {
  id: string;
  title: string;
  summary: string;
  category: "ground" | "stability" | "traction" | "traffic";
  /** Machines the scenario drives. The rest of the fleet keeps working. */
  cast: string[];
  /** Machine the camera should follow. */
  focus: string;
  setup: Action[];
  steps: Step[];
  expect: Expectation[];
  /** Hard stop, seconds. */
  timeoutS: number;
  /** Put the cast, weather and face back as they were afterwards. */
  restore: boolean;
}

export interface ScenarioStatus {
  id: string;
  title: string;
  t: number;
  step: string;
  done: boolean;
  /** Expectations met so far, with the time they were first met. */
  met: { label: string; at: number | null }[];
}
