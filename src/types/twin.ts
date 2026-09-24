/**
 * Core contract for the digital twin.
 *
 * Everything the 3D world draws is derived from `MachineTelemetry`. Today the
 * telemetry is produced by the keyboard (or the mock IoT generator); tomorrow it
 * can arrive over a WebSocket without touching a single 3D component.
 */

export type MachineActivity =
  | "idle"
  | "traveling"
  | "digging"
  | "loading"
  | "swinging"
  | "emergency_stop";

export type MachineKind = "excavator" | "bulldozer" | "loader" | "truck" | "grader";

export interface MachineTelemetry {
  machineId: string;

  /** World position in metres. `y` is ground height at (x, z). */
  x: number;
  y: number;
  z: number;

  /** Ground speed in m/s. Negative when reversing. */
  speed: number;
  /** Radians, 0 = north (-Z), increasing clockwise. */
  heading: number;

  engineRpm: number;
  /** Percent, 0-100. */
  fuel: number;

  /** Radians. Positive boom = raised. */
  boomAngle: number;
  stickAngle: number;
  bucketAngle: number;
  /** Radians. Upper-body rotation relative to the tracks. */
  swingAngle: number;

  /** Radians, from the terrain under the machine. */
  pitch: number;
  roll: number;

  /** Kilograms in the bucket / bed. */
  payload: number;

  /** Celsius. */
  hydraulicTemperature: number;

  /** Metres to the closest worker. `Infinity` when nobody is tracked. */
  nearestPerson: number;

  /** Demo stability figure. >= 1.5 safe, >= 1.2 warning, below that critical. */
  tipOverMargin: number;

  activity: MachineActivity;
}

export interface MachineDescriptor {
  id: string;
  model: string;
  kind: MachineKind;
  /** True for the machine the operator drives. */
  controllable: boolean;
  /** Assigned operator, keyed into the dataset's operator table. */
  operatorId?: string;
  /** Lifetime hours at commissioning, from the fleet records. */
  engineHours?: number;
}

export type WorkerState = "walking" | "working" | "idle";

export interface SiteWorker {
  id: string;
  x: number;
  z: number;
  state: WorkerState;
  /** Radians, facing direction, used to orient the 3D figure. */
  heading: number;
  /** Animation phase so the figures do not all step in unison. */
  phase: number;
}

/** Spec alias - `SiteWorker` is used internally to avoid shadowing DOM `Worker`. */
export type Worker = SiteWorker;

export type ProximityLevel = "safe" | "warning" | "critical";

export interface ProximityReading {
  workerId: string;
  distance: number;
  level: ProximityLevel;
}

export interface ProximityResult {
  /** Worst level across every tracked worker. */
  level: ProximityLevel;
  nearest: number;
  nearestWorkerId: string | null;
  readings: ProximityReading[];
}

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertKind =
  | "proximity"
  | "collision"
  | "tip_over"
  | "hydraulic"
  | "fuel"
  | "engine"
  | "weather"
  | "emergency_stop";

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  message: string;
  machineId: string;
  /** Free-form display rows, e.g. `{ Distance: "2.8 m" }`. */
  detail: Record<string, string>;
  recommendation: string;
  createdAt: number;
}

export interface SimEvent {
  id: string;
  /** Wall-clock label, e.g. "10:42:15". */
  time: string;
  text: string;
  severity: AlertSeverity;
}

export type WeatherMode = "clear" | "rain" | "fog" | "heat";

export type CameraMode = "follow" | "chase" | "orbit" | "top" | "site" | "driver";

export type TelemetrySource = "keyboard" | "mock_iot" | "websocket";

/** Connection state of a streaming telemetry source. */
export type LinkStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "unavailable";

export type TaskStatus = "pending" | "active" | "complete";

export interface SiteTask {
  id: string;
  name: string;
  zone: string;
  /** 0-100. */
  progress: number;
  status: TaskStatus;
  /** Activity that advances this task. */
  advancedBy: MachineActivity;
}

/**
 * Normalised operator intent. The keyboard hook and the mock IoT generator both
 * emit this shape, which keeps the physics identical for either source.
 */
export interface VehicleInput {
  /** -1 (reverse) .. 1 (forward). */
  throttle: number;
  /** -1 (left) .. 1 (right). */
  steer: number;
  /** -1 .. 1 upper-body swing. */
  swing: number;
  /** -1 .. 1 boom / stick / bucket rates. */
  boom: number;
  stick: number;
  bucket: number;
  emergencyStop: boolean;
}

export interface PredictedPath {
  machineId: string;
  from: [number, number, number];
  to: [number, number, number];
  /** Sampled points, ready to feed a drei <Line>. */
  points: [number, number, number][];
  speed: number;
}

export interface CollisionRisk {
  id: string;
  a: string;
  b: string;
  /** Metres between the two predicted positions. */
  separation: number;
  /** Seconds until the closest approach. */
  timeToClosest: number;
  point: [number, number, number];
}

/**
 * The seam that keeps the 3D layer source-agnostic.
 *
 * `MockTelemetryProvider` implements it today. A `WebSocketTelemetryProvider`
 * can implement it later and nothing downstream needs to change.
 */
export interface TelemetryProvider {
  readonly id: TelemetrySource;
  subscribe(callback: (data: MachineTelemetry[]) => void): () => void;
  start(): void;
  stop(): void;
}
