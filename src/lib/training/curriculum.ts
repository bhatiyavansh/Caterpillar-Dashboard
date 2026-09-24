/**
 * The guided-lesson curriculum.
 *
 * Every step carries its own pass condition as a pure predicate over live
 * `MachineTelemetry`. The coach (LLM or scripted) decides what to *say*; these
 * predicates alone decide whether a step *passed*. An 8B model asked "did the
 * learner reverse?" will say yes. The telemetry cannot be talked round.
 *
 * Keys come from `src/lib/twin/controls.ts` — nothing here invents a binding.
 */
import type { MachineTelemetry } from "@/types/twin";
import { ARM_LIMITS } from "@/lib/twin/telemetry";

const DEG = Math.PI / 180;

/** What a predicate may know besides the current frame. */
export interface StepContext {
  /** Telemetry captured the moment the step began. */
  start: Readonly<MachineTelemetry>;
  /** Milliseconds since the step began. */
  elapsedMs: number;
  emergencyStopped: boolean;
}

export interface StepHint {
  when: (t: MachineTelemetry, ctx: StepContext) => boolean;
  /** Plain diagnosis handed to the coach when the step times out. */
  reason: string;
}

export interface LessonStep {
  id: string;
  /** Scripted instruction — used as-is when the LLM is down. */
  brief: string;
  /** Scripted praise on pass. */
  praise: string;
  /** The real-machine control, for the lesson text. */
  realControl: string;
  /** Sim key codes shown on the key prompt. `Shift` is a modifier label. */
  keys: string[];
  success: (t: MachineTelemetry, ctx: StepContext) => boolean;
  /** Must hold for this long, so a twitch doesn't count. */
  holdMs: number;
  /** Fail after this, then ask the coach to remediate. */
  timeoutMs: number;
  hints: StepHint[];
  /** Optional side-effect when the step starts (hazard drills). */
  setup?: "spawn_worker" | "reset_machine";
  /** Live readout shown under the key prompt so the learner sees the target. */
  gauge: { label: string; read: (t: MachineTelemetry, ctx: StepContext) => string; target: string };
}

export interface LessonModule {
  id: string;
  title: string;
  /** The profile skill this module trains, from `training_profiles.json`. */
  skill: "digging" | "swinging" | "slope_work" | "safety" | "fuel_efficiency";
  summary: string;
  steps: LessonStep[];
}

/* ------------------------------------------------------------ helpers */

/** Signed smallest difference between two angles, radians. */
export function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

const kmh = (t: MachineTelemetry) => t.speed * 3.6;
const deg = (r: number) => `${Math.round(r / DEG)}°`;
const still = (t: MachineTelemetry) => Math.abs(t.speed) < 0.08;
const turned = (t: MachineTelemetry, c: StepContext) => angleDelta(c.start.heading, t.heading);
const swung = (t: MachineTelemetry, c: StepContext) => angleDelta(c.start.swingAngle, t.swingAngle);

/**
 * Raised a joint by `by`, or ran it into its stop trying. A step that starts
 * with the boom near full raise must still be passable.
 */
function raised(joint: "boom" | "stick" | "bucket", by: number) {
  const key = `${joint}Angle` as const;
  return (t: MachineTelemetry, c: StepContext) =>
    t[key] - c.start[key] > by || t[key] >= ARM_LIMITS[joint].max - 2 * DEG;
}

/* --------------------------------------------------------- curriculum */

export const CURRICULUM: LessonModule[] = [
  {
    id: "travel",
    title: "Travel control",
    skill: "fuel_efficiency",
    summary: "Move forty tonnes smoothly: forward, stop, reverse.",
    steps: [
      {
        id: "travel-forward",
        brief: "On a real 320 you push both travel pedals. Here, hold the UP ARROW and get her rolling above 3 km/h.",
        praise: "That's it. Feel how long she takes to get going. Forty tonnes doesn't hurry.",
        realControl: "Travel pedals, forward",
        keys: ["ArrowUp"],
        success: (t) => kmh(t) > 3,
        holdMs: 1200,
        timeoutMs: 20_000,
        hints: [
          { when: (t) => t.speed < -0.1, reason: "The machine is reversing; the learner pressed DOWN instead of UP." },
          { when: (t, c) => Math.abs(turned(t, c)) > 15 * DEG, reason: "The learner is steering with LEFT/RIGHT instead of travelling straight." },
          { when: (t) => kmh(t) > 0.5 && kmh(t) <= 3, reason: "Moving, but letting go before reaching 3 km/h." },
          { when: (t) => still(t), reason: "The machine never moved; the UP ARROW was not held." },
        ],
        gauge: { label: "Speed", read: (t) => `${kmh(t).toFixed(1)} km/h`, target: "> 3.0 km/h" },
      },
      {
        id: "travel-stop",
        brief: "Now release the UP ARROW and let her roll to a complete stop. No keys.",
        praise: "Clean stop. Anticipating the stop saves fuel and wear on the final drives.",
        realControl: "Release travel pedals",
        keys: [],
        success: (t) => still(t),
        holdMs: 1000,
        timeoutMs: 15_000,
        hints: [{ when: (t) => !still(t), reason: "The learner is still holding a travel key." }],
        gauge: { label: "Speed", read: (t) => `${kmh(t).toFixed(1)} km/h`, target: "0.0 km/h" },
      },
      {
        id: "travel-reverse",
        brief: "Check behind you, then hold the DOWN ARROW to reverse above 2 km/h.",
        praise: "Good reverse. On site, always check your rear camera before you do that.",
        realControl: "Travel pedals, back",
        keys: ["ArrowDown"],
        success: (t) => kmh(t) < -2,
        holdMs: 1000,
        timeoutMs: 20_000,
        hints: [
          { when: (t) => t.speed > 0.1, reason: "The machine is going forward; the learner pressed UP instead of DOWN." },
          { when: (t) => still(t), reason: "The machine never moved; the DOWN ARROW was not held." },
        ],
        gauge: { label: "Speed", read: (t) => `${kmh(t).toFixed(1)} km/h`, target: "< -2.0 km/h" },
      },
      {
        id: "travel-stop-2",
        brief: "Release and bring her to a stop again.",
        praise: "Stopped. That's full travel control.",
        realControl: "Release travel pedals",
        keys: [],
        success: (t) => still(t),
        holdMs: 1000,
        timeoutMs: 15_000,
        hints: [{ when: (t) => !still(t), reason: "The learner is still holding a travel key." }],
        gauge: { label: "Speed", read: (t) => `${kmh(t).toFixed(1)} km/h`, target: "0.0 km/h" },
      },
    ],
  },
  {
    id: "steering",
    title: "Steering",
    skill: "digging",
    summary: "Counter-rotate the tracks to turn on the spot.",
    steps: [
      {
        id: "steer-left",
        brief: "Pull the left track lever back. Here, hold the LEFT ARROW until you've turned 20 degrees.",
        praise: "Nice. The tracks counter-rotate, so she pivots almost on the spot.",
        realControl: "Track levers, left",
        keys: ["ArrowLeft"],
        success: (t, c) => turned(t, c) < -20 * DEG,
        holdMs: 300,
        timeoutMs: 20_000,
        hints: [
          { when: (t, c) => turned(t, c) > 5 * DEG, reason: "Turning the wrong way; the learner pressed RIGHT." },
          { when: (t, c) => Math.abs(turned(t, c)) < 3 * DEG, reason: "No rotation yet; LEFT ARROW not held long enough." },
        ],
        gauge: { label: "Turned", read: (t, c) => deg(turned(t, c)), target: "-20°" },
      },
      {
        id: "steer-right",
        brief: "Now hold the RIGHT ARROW and turn 20 degrees the other way.",
        praise: "Good. Smooth, deliberate turns keep the undercarriage from tearing up the ground.",
        realControl: "Track levers, right",
        keys: ["ArrowRight"],
        success: (t, c) => turned(t, c) > 20 * DEG,
        holdMs: 300,
        timeoutMs: 20_000,
        hints: [
          { when: (t, c) => turned(t, c) < -5 * DEG, reason: "Turning the wrong way; the learner pressed LEFT." },
          { when: (t, c) => Math.abs(turned(t, c)) < 3 * DEG, reason: "No rotation yet; RIGHT ARROW not held long enough." },
        ],
        gauge: { label: "Turned", read: (t, c) => deg(turned(t, c)), target: "+20°" },
      },
    ],
  },
  {
    id: "slew",
    title: "Slew and arm",
    skill: "swinging",
    summary: "Swing the house and work the boom, stick and bucket.",
    steps: [
      {
        id: "slew-left",
        brief: "The upper house swings independently of the tracks. Hold SHIFT and the LEFT ARROW to slew 45 degrees left.",
        praise: "That's slewing. The tracks stayed put while the house turned.",
        realControl: "Left joystick, left",
        keys: ["Shift", "ArrowLeft"],
        success: (t, c) => swung(t, c) < -45 * DEG,
        holdMs: 200,
        timeoutMs: 25_000,
        hints: [
          { when: (t, c) => Math.abs(turned(t, c)) > 10 * DEG, reason: "The tracks turned instead of the house; SHIFT was not held with the arrow." },
          { when: (t, c) => swung(t, c) > 5 * DEG, reason: "Slewing the wrong way; the learner pressed RIGHT." },
        ],
        gauge: { label: "Slew", read: (t, c) => deg(swung(t, c)), target: "-45°" },
      },
      {
        id: "boom-up",
        brief: "Raise the boom: right joystick back. Here, hold W until the boom is up 15 degrees.",
        praise: "Boom up. Raise before you swing so you clear anything on the ground.",
        realControl: "Right joystick, back",
        keys: ["KeyW"],
        success: raised("boom", 15 * DEG),
        holdMs: 200,
        timeoutMs: 20_000,
        hints: [{ when: (t, c) => t.boomAngle < c.start.boomAngle - 3 * DEG, reason: "Boom going down; the learner pressed S instead of W." }],
        gauge: { label: "Boom", read: (t, c) => deg(t.boomAngle - c.start.boomAngle), target: "+15°" },
      },
      {
        id: "stick-out",
        brief: "Reach out with the stick: hold D to extend it 20 degrees.",
        praise: "Good reach. Stick out, then curl in, is the heart of every dig.",
        realControl: "Left joystick, forward",
        keys: ["KeyD"],
        success: raised("stick", 20 * DEG),
        holdMs: 200,
        timeoutMs: 20_000,
        hints: [{ when: (t, c) => t.stickAngle < c.start.stickAngle - 3 * DEG, reason: "Stick curling in; the learner pressed A instead of D." }],
        gauge: { label: "Stick", read: (t, c) => deg(t.stickAngle - c.start.stickAngle), target: "+20°" },
      },
      {
        id: "bucket-curl",
        brief: "Curl the bucket to hold a load: hold Q for 25 degrees of curl.",
        praise: "Bucket curled. That's what keeps the spoil in on the swing.",
        realControl: "Right joystick, left",
        keys: ["KeyQ"],
        success: raised("bucket", 25 * DEG),
        holdMs: 200,
        timeoutMs: 20_000,
        hints: [{ when: (t, c) => t.bucketAngle < c.start.bucketAngle - 3 * DEG, reason: "Bucket dumping; the learner pressed E instead of Q." }],
        gauge: { label: "Bucket", read: (t, c) => deg(t.bucketAngle - c.start.bucketAngle), target: "+25°" },
      },
      {
        id: "slew-right",
        brief: "Swing back to the right: SHIFT and the RIGHT ARROW, 45 degrees.",
        praise: "Full cycle of the arm. You've just done the motions of a dig.",
        realControl: "Left joystick, right",
        keys: ["Shift", "ArrowRight"],
        success: (t, c) => swung(t, c) > 45 * DEG,
        holdMs: 200,
        timeoutMs: 25_000,
        hints: [
          { when: (t, c) => Math.abs(turned(t, c)) > 10 * DEG, reason: "The tracks turned instead of the house; SHIFT was not held." },
          { when: (t, c) => swung(t, c) < -5 * DEG, reason: "Slewing the wrong way; the learner pressed LEFT." },
        ],
        gauge: { label: "Slew", read: (t, c) => deg(swung(t, c)), target: "+45°" },
      },
    ],
  },
  {
    id: "people",
    title: "Working near people",
    skill: "safety",
    summary: "A worker walks into your zone. Stop, hold, and use the e-stop.",
    steps: [
      {
        id: "people-stop",
        brief: "A worker is walking toward the machine. Take your hands off every control and hold completely still.",
        praise: "Correct. When someone enters your zone, everything stops until they are clear.",
        realControl: "Hands off all controls",
        keys: [],
        setup: "spawn_worker",
        success: (t, c) => still(t) && c.elapsedMs > 1500,
        holdMs: 2500,
        timeoutMs: 20_000,
        hints: [{ when: (t) => !still(t), reason: "The learner kept moving the machine while a worker approached." }],
        gauge: {
          label: "Nearest person",
          read: (t) => (Number.isFinite(t.nearestPerson) ? `${t.nearestPerson.toFixed(1)} m` : "none"),
          target: "Machine still",
        },
      },
      {
        id: "people-estop",
        brief: "Now practise the emergency stop. Press SPACE to hit the cab e-stop.",
        praise: "E-stop engaged. Knowing where it is without looking is the point of drilling it.",
        realControl: "Cab emergency stop",
        keys: ["Space"],
        success: (_t, c) => c.emergencyStopped,
        holdMs: 0,
        timeoutMs: 15_000,
        hints: [{ when: (_t, c) => !c.emergencyStopped, reason: "SPACE was not pressed. Focus may be on a button; click the 3D view first." }],
        gauge: { label: "E-stop", read: (_t, c) => (c.emergencyStopped ? "ENGAGED" : "released"), target: "ENGAGED" },
      },
      {
        id: "people-release",
        brief: "Worker's clear. Press SPACE again to release the e-stop.",
        praise: "Released. Lesson complete.",
        realControl: "Release emergency stop",
        keys: ["Space"],
        success: (_t, c) => !c.emergencyStopped,
        holdMs: 0,
        timeoutMs: 15_000,
        hints: [{ when: (_t, c) => c.emergencyStopped, reason: "The e-stop is still engaged; SPACE not pressed again." }],
        gauge: { label: "E-stop", read: (_t, c) => (c.emergencyStopped ? "ENGAGED" : "released"), target: "released" },
      },
    ],
  },
];

export const TOTAL_STEPS = CURRICULUM.reduce((n, m) => n + m.steps.length, 0);

/** Human label for a key code, for key caps and for the coach prompt. */
export function keyLabel(code: string): string {
  const map: Record<string, string> = {
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Space: "Space",
    Shift: "Shift",
  };
  return map[code] ?? code.replace(/^Key/, "");
}
