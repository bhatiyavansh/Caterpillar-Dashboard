/**
 * The physics scenario library.
 *
 * Each entry is plain data (see types.ts). Nothing here says what the outcome
 * *will* be — only how the site is set up and what the operators do. The
 * rigid-body world decides whether the face fails, the machine goes over or
 * the truck loses the ramp, and the expectations record whether it did.
 *
 * To add a scenario, append a definition. The engine, the runner and the
 * director panel pick it up from `PHYSICS_SCENARIOS`.
 */

import { SHALLOW_FACE, SIDEHILL } from "../../site";
import type { PhysicsScenario } from "./types";

const FACE_X = (SHALLOW_FACE.x1 + SHALLOW_FACE.x2) / 2;
const SIDEHILL_X = (SIDEHILL.x1 + SIDEHILL.x2) / 2;
const SIDEHILL_Z = (SIDEHILL.z1 + SIDEHILL.z2) / 2;
/** Open ground east of the sidehill, clear of roads, props and crew. */
const OPEN = { x: 124, z: -112 };

export const PHYSICS_SCENARIOS: PhysicsScenario[] = [
  {
    id: "slope-failure",
    title: "Slope failure at bench face C",
    summary:
      "EXC001 tracks up to the crest of an over-steep 5.5 m face to start a cut. The crest can't carry 22 t for long: the rock wedge under the front of the tracks breaks free and slides.",
    category: "ground",
    cast: ["EXC001"],
    focus: "EXC001",
    setup: [
      { kind: "weather", mode: "clear" },
      { kind: "place", machine: "EXC001", x: FACE_X, z: SHALLOW_FACE.crestZ + 9, heading: 0 },
      { kind: "arm", machine: "EXC001", boom: 30, stick: -10, bucket: 20, swing: 0 },
    ],
    steps: [
      {
        label: "Tracking up to the crest",
        do: [{ kind: "driveTo", machine: "EXC001", x: FACE_X, z: SHALLOW_FACE.intactCrestZ + 1, cruise: 0.35 }],
      },
      {
        label: "Face C gives way",
        when: { kind: "faceFailed" },
        do: [
          { kind: "stop", machine: "EXC001" },
          { kind: "event", text: "Crest collapse under EXC001 — tracks losing ground", severity: "critical" },
        ],
      },
      { label: "Debris settling", when: { kind: "elapsed", s: 10 }, do: [{ kind: "end" }] },
    ],
    expect: [
      { label: "Face fails under load", when: { kind: "faceFailed" } },
      { label: "Excavator pitched past 10°", when: { kind: "tiltAbove", machine: "EXC001", deg: 10 } },
    ],
    timeoutS: 60,
    restore: true,
  },
  {
    id: "load-shift-tipover",
    title: "Load shift on a sidehill",
    summary:
      "EXC001 works across the 13° sidehill bench and swings a part load out over the downhill side, arm tucked in — marginal but holding. Then the slung load shifts and runs out to full reach. The centre of mass leaves the track footprint.",
    category: "stability",
    cast: ["EXC001"],
    focus: "EXC001",
    setup: [
      { kind: "weather", mode: "clear" },
      // Heading north along the contour: downhill is the machine's right.
      { kind: "place", machine: "EXC001", x: SIDEHILL_X - 2, z: SIDEHILL_Z, heading: 0, payload: 0 },
      { kind: "arm", machine: "EXC001", boom: 35, stick: -20, bucket: 30, swing: 0 },
    ],
    steps: [
      {
        label: "Swinging a part load out downhill",
        when: { kind: "elapsed", s: 1 },
        do: [
          { kind: "payload", machine: "EXC001", kg: 1200 },
          { kind: "arm", machine: "EXC001", swing: 90, boom: 25, stick: 10, bucket: 40 },
        ],
      },
      {
        label: "Slung load shifts in the bucket",
        when: { kind: "any", of: [{ kind: "armSettled", machine: "EXC001" }, { kind: "elapsed", s: 14 }] },
        do: [
          { kind: "payload", machine: "EXC001", kg: 7500 },
          { kind: "arm", machine: "EXC001", boom: -10, stick: 50 },
          { kind: "event", text: "Slung load shifts: 7.5 t running out to full reach over the downhill track", severity: "critical" },
        ],
      },
      {
        label: "Machine going over",
        when: { kind: "tipped", machine: "EXC001" },
        do: [{ kind: "stop", machine: "EXC001" }],
      },
      { label: "Aftermath", when: { kind: "elapsed", s: 6 }, do: [{ kind: "end" }] },
    ],
    expect: [
      { label: "Stability alert before the tip", when: { kind: "marginBelow", machine: "EXC001", value: 1.2 } },
      { label: "Holds with the arm tucked in", when: { kind: "all", of: [{ kind: "armSettled", machine: "EXC001" }, { kind: "elapsed", s: 3 }] } },
      { label: "Machine overturns", when: { kind: "tipped", machine: "EXC001" } },
    ],
    timeoutS: 45,
    restore: true,
  },
  {
    id: "wet-ramp-slip",
    title: "Loaded truck on a wet tip ramp",
    summary:
      "After rain, TRK001 takes 30 t up the 20% dump ramp. Loose spoil soaked through grips at μ ≈ 0.16 — less than the grade needs. The wheels spin and, braked, the truck still slides back.",
    category: "traction",
    cast: ["TRK001"],
    focus: "TRK001",
    setup: [
      { kind: "weather", mode: "rain" },
      { kind: "soak", level: 1 },
      { kind: "place", machine: "TRK001", x: -96, z: 6, heading: 0, payload: 30_000 },
    ],
    steps: [
      {
        label: "Climbing the wet ramp",
        when: { kind: "elapsed", s: 1 },
        do: [
          { kind: "driveTo", machine: "TRK001", x: -96, z: -36, cruise: 0.9 },
        ],
      },
      {
        label: "Wheels spinning",
        when: { kind: "slipping", machine: "TRK001", above: 0.45 },
        do: [{ kind: "event", text: "TRK001 wheelspin on the dump ramp — grip lost", severity: "warning" }],
      },
      {
        label: "Brakes on — sliding anyway",
        when: { kind: "elapsed", s: 3 },
        do: [
          { kind: "stop", machine: "TRK001" },
          { kind: "mark", machine: "TRK001" },
        ],
      },
      { label: "Settled", when: { kind: "elapsed", s: 7 }, do: [{ kind: "end" }] },
    ],
    expect: [
      { label: "Traction lost on the grade", when: { kind: "slipping", machine: "TRK001", above: 0.45 } },
      { label: "Truck slides back 2 m", when: { kind: "rolledBack", machine: "TRK001", metres: 2 } },
    ],
    timeoutS: 40,
    restore: true,
  },
  {
    id: "near-miss-v2v",
    title: "Dozer reversing — V2V stop",
    summary:
      "DOZ001 reverses blind across open ground toward EXC001. The machine-to-machine sensor sees the excavator's hull in the dozer's path and brakes it to a stop short of contact.",
    category: "traffic",
    cast: ["DOZ001", "EXC001"],
    focus: "DOZ001",
    setup: [
      { kind: "place", machine: "EXC001", x: OPEN.x, z: OPEN.z, heading: 90 },
      { kind: "place", machine: "DOZ001", x: OPEN.x, z: OPEN.z + 20, heading: 180 },
      { kind: "avoidance", machine: "DOZ001", on: true },
    ],
    steps: [
      {
        label: "Dozer reversing blind",
        when: { kind: "elapsed", s: 1 },
        do: [{ kind: "drive", machine: "DOZ001", throttle: -1 }],
      },
      {
        label: "V2V braking",
        when: { kind: "all", of: [{ kind: "elapsed", s: 4 }, { kind: "stopped", machine: "DOZ001" }] },
        do: [{ kind: "event", text: "V2V: DOZ001 held short of EXC001", severity: "warning" }],
      },
      { label: "Clear", when: { kind: "elapsed", s: 4 }, do: [{ kind: "end" }] },
    ],
    expect: [
      { label: "Dozer brought to a stop", when: { kind: "all", of: [{ kind: "stopped", machine: "DOZ001" }, { kind: "near", machine: "DOZ001", x: OPEN.x, z: OPEN.z, within: 14 }] } },
      { label: "Contact (should not happen)", when: { kind: "contact", a: "DOZ001", b: "EXC001" } },
    ],
    timeoutS: 30,
    restore: true,
  },
  {
    id: "dozer-intercept",
    title: "Dozer on a collision course",
    summary:
      "DOZ001 drives straight at EXC001 with its proximity system faulted. The conflict is predicted seconds out; nothing stops the dozer, and the blade meets the excavator. 23 t against 22 t — the excavator is shoved.",
    category: "traffic",
    cast: ["DOZ001", "EXC001"],
    focus: "EXC001",
    setup: [
      { kind: "place", machine: "EXC001", x: OPEN.x, z: OPEN.z, heading: 90 },
      { kind: "place", machine: "DOZ001", x: OPEN.x, z: OPEN.z + 32, heading: 0 },
      { kind: "avoidance", machine: "DOZ001", on: false },
      { kind: "event", text: "DOZ001 on intercept course with EXC001 — proximity sensor fault", severity: "warning" },
    ],
    steps: [
      {
        label: "Closing",
        when: { kind: "elapsed", s: 0.5 },
        do: [{ kind: "driveTo", machine: "DOZ001", x: OPEN.x, z: OPEN.z - 4, cruise: 1 }],
      },
      {
        label: "Impact",
        when: { kind: "contact", a: "DOZ001", b: "EXC001" },
        do: [{ kind: "event", text: "DOZ001 blade strikes EXC001", severity: "critical" }],
      },
      { label: "Operator stops", when: { kind: "elapsed", s: 1.5 }, do: [{ kind: "stop", machine: "DOZ001" }] },
      { label: "Aftermath", when: { kind: "elapsed", s: 5 }, do: [{ kind: "end" }] },
    ],
    expect: [
      { label: "Machines make contact", when: { kind: "contact", a: "DOZ001", b: "EXC001" } },
    ],
    timeoutS: 40,
    restore: true,
  },
];

export function getPhysicsScenario(id: string): PhysicsScenario | undefined {
  return PHYSICS_SCENARIOS.find((s) => s.id === id);
}
