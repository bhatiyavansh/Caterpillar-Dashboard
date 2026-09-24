/**
 * Machine component registry for the X-ray view.
 *
 * One entry per major assembly the rig components draw (Excavator.tsx,
 * Bulldozer.tsx, Loader.tsx, Truck.tsx tag their meshes with
 * `userData.part = <id>`), plus the internal assemblies X-ray reveals — pump,
 * hydraulic lines, engine block — which only exist as meshes in X-ray mode.
 *
 * Each entry says how to read the component live from telemetry (when a
 * signal backs it), which of the maintenance model's tracked components it
 * maps to (`intelligence/maintenance.py` COMPONENTS: hydraulic_pump, engine,
 * undercarriage), which alerts and anomaly patterns concern it, and where
 * the camera should look to frame it.
 */

import type { MachineKind, MachineTelemetry } from "@/types/twin";
import { DEG } from "./telemetry";

export type MaintenanceKey = "hydraulic_pump" | "engine" | "undercarriage";

export interface ComponentReading {
  label: string;
  value: string;
  tone: "ok" | "warn" | "crit";
}

export interface ComponentSpec {
  id: string;
  label: string;
  /** Tracked by the maintenance forecast under this key. */
  maintenance?: MaintenanceKey;
  /** Alert kinds (twin and fleet) that concern this component. */
  alertKinds: string[];
  /** Anomaly patterns (intelligence/anomaly) that concern this component. */
  anomalyPatterns: string[];
  /** Live reading, when telemetry carries a signal for it. */
  reading?: (t: MachineTelemetry) => ComponentReading[];
  /** Point to frame, body frame (−Z forward), metres. */
  focus: { x: number; y: number; z: number };
  /** Only exists as geometry in X-ray mode. */
  internal?: boolean;
}

const tone = (v: number, warn: number, crit: number, higherIsWorse = true): ComponentReading["tone"] =>
  higherIsWorse ? (v >= crit ? "crit" : v >= warn ? "warn" : "ok") : v <= crit ? "crit" : v <= warn ? "warn" : "ok";

const hydraulic = (t: MachineTelemetry): ComponentReading[] => [
  { label: "Oil temperature", value: `${t.hydraulicTemperature.toFixed(0)} °C`, tone: tone(t.hydraulicTemperature, 85, 95) },
];

const engine = (t: MachineTelemetry): ComponentReading[] => [
  { label: "Engine speed", value: `${Math.round(t.engineRpm)} rpm`, tone: tone(t.engineRpm, 2050, 2150) },
  { label: "Fuel", value: `${Math.round(t.fuel)} %`, tone: tone(t.fuel, 25, 15, false) },
];

const stability = (t: MachineTelemetry): ComponentReading[] => [
  { label: "Tip-over margin", value: t.tipOverMargin.toFixed(2), tone: tone(t.tipOverMargin, 1.5, 1.2, false) },
  { label: "Attitude", value: `${(t.pitch / DEG).toFixed(1)}° / ${(t.roll / DEG).toFixed(1)}°`, tone: "ok" },
  { label: "Ground speed", value: `${Math.abs(t.speed * 3.6).toFixed(1)} km/h`, tone: "ok" },
];

const payload = (max: number) => (t: MachineTelemetry): ComponentReading[] => [
  { label: "Load", value: `${Math.round(t.payload).toLocaleString()} kg`, tone: tone(t.payload, max * 0.9, max * 1.1) },
];

const joint = (label: string, pick: (t: MachineTelemetry) => number) => (t: MachineTelemetry): ComponentReading[] => [
  { label, value: `${(pick(t) / DEG).toFixed(0)}°`, tone: "ok" },
  ...hydraulic(t),
];

const HYD_ALERTS = ["hydraulic", "maintenance"];
const HYD_PATTERNS = ["temperature_anomaly", "harsh_operation"];

export const COMPONENTS: Record<MachineKind, ComponentSpec[]> = {
  excavator: [
    { id: "hydraulic_pump", label: "Hydraulic pump", maintenance: "hydraulic_pump", alertKinds: HYD_ALERTS, anomalyPatterns: HYD_PATTERNS, reading: hydraulic, focus: { x: 0.7, y: 2.1, z: 0.9 }, internal: true },
    { id: "hydraulic_lines", label: "Hydraulic lines", maintenance: "hydraulic_pump", alertKinds: ["hydraulic"], anomalyPatterns: HYD_PATTERNS, reading: hydraulic, focus: { x: 0.45, y: 3, z: -3 }, internal: true },
    { id: "engine", label: "Engine", maintenance: "engine", alertKinds: ["engine", "fuel", "anomaly"], anomalyPatterns: ["excessive_idling", "low_productivity"], reading: engine, focus: { x: 0, y: 2.3, z: 1.3 }, internal: true },
    { id: "undercarriage", label: "Undercarriage & tracks", maintenance: "undercarriage", alertKinds: ["tip_over", "collision", "weather"], anomalyPatterns: ["overload", "unusual_pattern"], reading: stability, focus: { x: 0, y: 0.6, z: 0 } },
    { id: "house", label: "Upper structure", alertKinds: ["collision"], anomalyPatterns: [], focus: { x: 0, y: 2, z: 0.3 } },
    { id: "counterweight", label: "Counterweight", alertKinds: ["tip_over"], anomalyPatterns: ["overload"], reading: stability, focus: { x: 0, y: 1.8, z: 2.3 } },
    { id: "cab", label: "Cab", alertKinds: ["proximity", "seatbelt", "fatigue"], anomalyPatterns: ["seatbelt_violation"], focus: { x: -0.7, y: 2.6, z: -0.6 } },
    { id: "boom", label: "Boom", alertKinds: ["tip_over"], anomalyPatterns: ["overload"], reading: joint("Boom angle", (t) => t.boomAngle), focus: { x: 0.45, y: 3.4, z: -3.4 } },
    { id: "boom_ram", label: "Boom cylinder", maintenance: "hydraulic_pump", alertKinds: ["hydraulic"], anomalyPatterns: HYD_PATTERNS, reading: joint("Boom angle", (t) => t.boomAngle), focus: { x: 0.45, y: 2.4, z: -2.6 } },
    { id: "stick", label: "Stick", alertKinds: [], anomalyPatterns: ["overload"], reading: joint("Stick angle", (t) => t.stickAngle), focus: { x: 0.45, y: 3.2, z: -6.5 } },
    { id: "stick_ram", label: "Stick cylinder", maintenance: "hydraulic_pump", alertKinds: ["hydraulic"], anomalyPatterns: HYD_PATTERNS, reading: joint("Stick angle", (t) => t.stickAngle), focus: { x: 0.45, y: 3.9, z: -4.6 } },
    { id: "bucket", label: "Bucket", alertKinds: ["tip_over"], anomalyPatterns: ["overload"], reading: payload(2400), focus: { x: 0.45, y: 1.8, z: -8.2 } },
    { id: "bucket_ram", label: "Bucket cylinder", maintenance: "hydraulic_pump", alertKinds: ["hydraulic"], anomalyPatterns: HYD_PATTERNS, reading: joint("Bucket angle", (t) => t.bucketAngle), focus: { x: 0.45, y: 3, z: -7 } },
  ],
  bulldozer: [
    { id: "hydraulic_pump", label: "Hydraulic pump", maintenance: "hydraulic_pump", alertKinds: HYD_ALERTS, anomalyPatterns: HYD_PATTERNS, reading: hydraulic, focus: { x: 0.6, y: 1.3, z: -0.2 }, internal: true },
    { id: "hydraulic_lines", label: "Blade hydraulics", maintenance: "hydraulic_pump", alertKinds: ["hydraulic"], anomalyPatterns: HYD_PATTERNS, reading: hydraulic, focus: { x: 1.2, y: 1, z: -2 }, internal: true },
    { id: "engine", label: "Engine", maintenance: "engine", alertKinds: ["engine", "fuel", "anomaly"], anomalyPatterns: ["excessive_idling", "low_productivity"], reading: engine, focus: { x: 0, y: 1.5, z: -1 }, internal: true },
    { id: "undercarriage", label: "Undercarriage & tracks", maintenance: "undercarriage", alertKinds: ["tip_over", "collision", "weather"], anomalyPatterns: ["overload", "unusual_pattern"], reading: stability, focus: { x: 0, y: 0.6, z: 0 } },
    { id: "cab", label: "Cab (ROPS)", alertKinds: ["proximity", "seatbelt", "fatigue"], anomalyPatterns: ["seatbelt_violation"], focus: { x: 0, y: 2.1, z: 0.75 } },
    { id: "push_arms", label: "Push arms", alertKinds: ["collision"], anomalyPatterns: [], focus: { x: 1.2, y: 0.8, z: -2 } },
    { id: "moldboard", label: "Blade (moldboard)", alertKinds: ["collision"], anomalyPatterns: ["overload"], reading: payload(8000), focus: { x: 0, y: 0.8, z: -3.1 } },
    { id: "ripper", label: "Ripper", alertKinds: [], anomalyPatterns: [], focus: { x: 0, y: 0.7, z: 2.4 } },
  ],
  loader: [
    { id: "hydraulic_pump", label: "Hydraulic pump", maintenance: "hydraulic_pump", alertKinds: HYD_ALERTS, anomalyPatterns: HYD_PATTERNS, reading: hydraulic, focus: { x: 0.5, y: 1.2, z: 0.6 }, internal: true },
    { id: "hydraulic_lines", label: "Lift & tilt hydraulics", maintenance: "hydraulic_pump", alertKinds: ["hydraulic"], anomalyPatterns: HYD_PATTERNS, reading: hydraulic, focus: { x: 0, y: 1.5, z: -2.3 }, internal: true },
    { id: "engine", label: "Engine", maintenance: "engine", alertKinds: ["engine", "fuel", "anomaly"], anomalyPatterns: ["excessive_idling", "low_productivity"], reading: engine, focus: { x: 0, y: 1.3, z: 1.9 }, internal: true },
    { id: "undercarriage", label: "Axles & tyres", maintenance: "undercarriage", alertKinds: ["tip_over", "collision", "weather"], anomalyPatterns: ["overload", "unusual_pattern"], reading: stability, focus: { x: 1.25, y: 0.8, z: 0 } },
    { id: "articulation", label: "Articulation joint", alertKinds: ["tip_over"], anomalyPatterns: ["harsh_operation"], focus: { x: 0, y: 1.1, z: 0.35 } },
    { id: "counterweight", label: "Counterweight", alertKinds: ["tip_over"], anomalyPatterns: ["overload"], reading: stability, focus: { x: 0, y: 0.95, z: 3.2 } },
    { id: "cab", label: "Cab", alertKinds: ["proximity", "seatbelt", "fatigue"], anomalyPatterns: ["seatbelt_violation"], focus: { x: 0, y: 2.3, z: 0.75 } },
    { id: "lift_arms", label: "Lift arms", alertKinds: [], anomalyPatterns: ["overload"], reading: payload(6000), focus: { x: 1.05, y: 1, z: -2.6 } },
    { id: "bucket", label: "Bucket", alertKinds: [], anomalyPatterns: ["overload"], reading: payload(6000), focus: { x: 0, y: 0.6, z: -4.05 } },
  ],
  truck: [
    { id: "hydraulic_pump", label: "Hoist pump", maintenance: "hydraulic_pump", alertKinds: HYD_ALERTS, anomalyPatterns: HYD_PATTERNS, reading: hydraulic, focus: { x: 0.5, y: 1.3, z: -1.2 }, internal: true },
    { id: "hydraulic_lines", label: "Hoist cylinders", maintenance: "hydraulic_pump", alertKinds: ["hydraulic"], anomalyPatterns: HYD_PATTERNS, reading: hydraulic, focus: { x: 1.1, y: 1.6, z: 1.2 }, internal: true },
    { id: "engine", label: "Engine", maintenance: "engine", alertKinds: ["engine", "fuel", "anomaly"], anomalyPatterns: ["excessive_idling", "low_productivity"], reading: engine, focus: { x: 0, y: 1.6, z: -3 }, internal: true },
    { id: "undercarriage", label: "Axles, tyres & brakes", maintenance: "undercarriage", alertKinds: ["tip_over", "collision", "weather"], anomalyPatterns: ["overload", "unusual_pattern"], reading: stability, focus: { x: 1.45, y: 0.95, z: 2.3 } },
    { id: "cab", label: "Cab", alertKinds: ["proximity", "seatbelt", "fatigue"], anomalyPatterns: ["seatbelt_violation"], focus: { x: 0, y: 2.4, z: -1.9 } },
    { id: "hitch", label: "Articulation hitch", alertKinds: ["tip_over"], anomalyPatterns: ["harsh_operation"], focus: { x: 0, y: 1.05, z: -0.1 } },
    { id: "dump_body", label: "Dump body", alertKinds: ["tip_over"], anomalyPatterns: ["overload"], reading: payload(41000), focus: { x: 0, y: 2.4, z: 2 } },
  ],
};

export function componentsFor(kind: MachineKind): ComponentSpec[] {
  return COMPONENTS[kind];
}

export function componentSpec(kind: MachineKind, id: string | null | undefined): ComponentSpec | undefined {
  return id ? COMPONENTS[kind].find((c) => c.id === id) : undefined;
}

/**
 * Machine id -> kind. Fleet ids carry the kind in their prefix (EXC, DOZ,
 * WHL, TRK); the older records pages use model-number ids (CAT-D6-011), so
 * those are recognised by model too. Graders have no twin model: null.
 */
export function kindOf(machineId: string): MachineKind | null {
  const id = machineId.toUpperCase();
  const p = id.slice(0, 3);
  if (p === "EXC" || /(^|-)3(20|36)(-|$)/.test(id)) return "excavator";
  if (p === "DOZ" || /(^|-)D[5-9](-|$)/.test(id)) return "bulldozer";
  if (p === "WHL" || /(^|-)9[5-8]\d(-|$)/.test(id)) return "loader";
  if (p === "TRK" || /(^|-)7[34]\d(-|$)/.test(id)) return "truck";
  return null;
}

/**
 * Picks the component an issue is about, from whatever the issue carries: an
 * explicit component id, an alert kind, an anomaly pattern, or free text such
 * as a maintenance line ("Hydraulic system", "Powertrain").
 */
export function componentForIssue(
  kind: MachineKind,
  issue: { component?: string | null; alertKind?: string | null; pattern?: string | null; text?: string | null },
): string | null {
  const list = COMPONENTS[kind];
  if (issue.component && list.some((c) => c.id === issue.component)) return issue.component;
  const text = `${issue.component ?? ""} ${issue.text ?? ""}`.toLowerCase();
  if (text.trim()) {
    if (/hydraul|pump|oil temp|hoist/.test(text)) return "hydraulic_pump";
    if (/engine|powertrain|fuel|idl|rpm|coolant|ecm/.test(text)) return "engine";
    if (/undercarriage|track|tyre|tire|brak|axle|traction|slip/.test(text)) return "undercarriage";
    if (/bucket/.test(text) && list.some((c) => c.id === "bucket")) return "bucket";
    if (/blade|moldboard|drawbar|circle/.test(text) && list.some((c) => c.id === "moldboard")) return "moldboard";
    if (/seat ?belt|cab|operator|fatigue/.test(text)) return "cab";
  }
  if (issue.pattern) {
    const byPattern = list.find((c) => c.anomalyPatterns.includes(issue.pattern as string));
    if (byPattern) return byPattern.id;
  }
  if (issue.alertKind) {
    const byAlert = list.find((c) => c.alertKinds.includes(issue.alertKind as string));
    if (byAlert) return byAlert.id;
  }
  return null;
}
