/**
 * Domain contracts for the whole product surface.
 *
 * Every screen reads these shapes and nothing else. The mock source and the
 * live WebSocket/REST source both produce them, so swapping the transport
 * never reaches a component.
 */

/* ------------------------------------------------------------------ enums */

export type MachineStatus =
  | "operating"
  | "idle"
  | "warning"
  | "critical"
  | "maintenance"
  | "offline";

export type MachineKind = "excavator" | "dozer" | "loader" | "truck" | "grader";

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertKind =
  | "seatbelt"
  | "proximity"
  | "fatigue"
  | "tip_over"
  | "collision"
  | "hydraulic"
  | "anomaly"
  | "weather"
  | "maintenance"
  | "fuel";

export type AlertSource = "simulator" | "webcam" | "v2v" | "rules" | "ml" | "director";

export type SeatbeltState = "fastened" | "unfastened" | "not_fitted";

export type ProximityLevel = "safe" | "warning" | "critical";

export type WeatherMode = "clear" | "rain" | "fog" | "heat";

export type ConnectionState = "connecting" | "live" | "simulated" | "error";

/* --------------------------------------------------------------- entities */

export interface OperatorRef {
  id: string;
  name: string;
  shift: string;
  skill: "novice" | "intermediate" | "expert";
  /** Years on this machine class — a feature of the task-time model. */
  years: number;
}

export interface SitePosition {
  /** Metres east of site origin. */
  x: number;
  /** Metres north of site origin. */
  z: number;
}

export interface Machine {
  id: string;
  kind: MachineKind;
  /** Marketing model, e.g. "CAT 320". */
  model: string;
  /** Human label for the machine kind, e.g. "Excavator". */
  kindLabel: string;
  status: MachineStatus;
  zone: string;
  operator: OperatorRef | null;
  taskId: string | null;
  taskLabel: string | null;
  taskProgress: number;

  /** Percent 0-100. */
  fuel: number;
  /** Litres burnt this shift. */
  fuelUsedL: number;
  hydraulicTemperature: number;
  coolantTemperature: number;
  /** Stability ratio. >= 1.5 safe, 1.2-1.5 caution, < 1.2 critical. */
  tipOverMargin: number;
  /** Percent 0-100. */
  utilization: number;
  /** Percent 0-100 of rated payload. */
  load: number;
  payloadKg: number;
  speedKmh: number;
  engineHours: number;
  idleMinutes: number;
  loadCycles: number;
  seatbelt: SeatbeltState;

  position: SitePosition;
  /** Degrees clockwise from north. */
  heading: number;

  proximity: {
    /** Metres to closest tracked person, or null when nobody is near. */
    nearestPersonM: number | null;
    level: ProximityLevel;
    /** Bearing of the hazard relative to the machine. */
    zone: "front" | "rear" | "left" | "right" | null;
  };

  /** Ids of currently open alerts raised against this machine. */
  alertIds: string[];
}

export interface SiteAlert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  source: AlertSource;
  machineId: string;
  title: string;
  /** One sentence: what happened. */
  message: string;
  /** One sentence: why the system believes it. */
  cause: string;
  /** Imperative next step for the person reading it. */
  action: string;
  /** Display rows, e.g. `{ Distance: "2.4 m" }`. */
  detail: Record<string, string>;
  createdAt: number;
  acknowledged: boolean;
  resolvedAt: number | null;
}

export type TaskState = "done" | "active" | "queued";

/** One term of the estimate, in minutes — what moved the number and by how much. */
export interface EstimateDriver {
  feature: string;
  label: string;
  impactMin: number;
}

export interface SiteTask {
  id: string;
  machineId: string;
  title: string;
  zone: string;
  state: TaskState;
  /** Percent 0-100. */
  progress: number;
  /** Minutes remaining, P50 estimate. */
  etaMinutes: number;
  /** P10/P90 band around the estimate, in minutes. */
  etaRange: [number, number];
  /** Clock label for when it should start, e.g. "14:20". */
  startsAt: string;
  /** The drivers above, rendered as short strings for compact surfaces. */
  reasons: string[];

  /* ---- what the estimate was made from, and what it concluded ---- */

  /** Model input: the job being done. */
  taskType: TaskType;
  /** Model input: ground being worked. */
  soil: Soil;
  /** Model input: job size in the task type's own unit. */
  volume: number;
  /** Minutes for the whole job, not just what is left. */
  totalMinutes: number;
  /** What the site office's own arithmetic said, for comparison. */
  plannerMinutes: number;
  /** Ranked terms behind the P50, in minutes. */
  drivers: EstimateDriver[];
}

export type TaskType = "trenching" | "loading" | "grading" | "dozing" | "hauling";
export type Soil = "sand" | "mixed" | "clay" | "rock";

export interface TelemetryPoint {
  /** Epoch millis. */
  t: number;
  /** Clock label for axes. */
  label: string;
  fuel: number;
  hydraulicTemperature: number;
  tipOverMargin: number;
  utilization: number;
  speedKmh: number;
}

export interface Incident {
  id: string;
  machineId: string;
  title: string;
  kind: AlertKind;
  severity: AlertSeverity;
  /** Epoch millis. */
  at: number;
  zone: string;
  summary: string;
  /** Set when the incident has a stored replay in the twin. */
  replayable: boolean;
  status: "draft" | "filed" | "reviewed";

  /** Who was in the seat, where the machine was, what the weather was doing. */
  operatorId: string | null;
  operatorName: string | null;
  weather: WeatherMode;
  /** Machine position at the moment it was logged. */
  position: SitePosition | null;
  /** The alert that opened it, when one did. */
  alertId: string | null;
  /** Set by the supervisor when the incident is reviewed. */
  note: string | null;
  /** True when the log wrote itself rather than a person filing it. */
  automatic: boolean;
}

export interface MaintenanceItem {
  id: string;
  machineId: string;
  title: string;
  component: string;
  /** Engine hours until the service is due; negative means overdue. */
  dueInHours: number;
  dueLabel: string;
  severity: AlertSeverity;
  /** Predicted remaining useful life as a percentage. */
  healthPct: number;
  workOrder: string | null;
}

export type AnomalyPattern =
  | "excessive_idling"
  | "seatbelt_violation"
  | "overload"
  | "harsh_operation"
  | "temperature_anomaly"
  | "low_productivity"
  | "unusual_pattern";

export interface Anomaly {
  id: string;
  machineId: string;
  title: string;
  /** Plain-language explanation produced by the model + LLM. */
  explanation: string;
  /** e.g. "idle 63 min against a 24 min norm". */
  deviation: string;
  /** Rupees. */
  costInr: number;
  detectedAt: number;
  severity: AlertSeverity;

  /** Which named pattern fired. */
  pattern: AnomalyPattern;
  /** Patterns that fired alongside it — co-occurrence is the strong signal. */
  related: AnomalyPattern[];
  /** 0-1 from the detector. */
  score: number;
  /** Which layer caught it. */
  detectedBy: "rules" | "baseline_deviation";
  /** The window's own numbers, so a screen can show the working. */
  evidence: Record<string, string>;
  /** Diesel burnt producing nothing, litres. */
  fuelWastedL: number;
}

export interface FleetKpis {
  fleetSize: number;
  active: number;
  atRisk: number;
  openAlerts: number;
  /** Percent 0-100. */
  utilization: number;
  fuelUsedL: number;
}

export interface OwnerKpis {
  fleetCostInr: number;
  idleCostInr: number;
  fuelL: number;
  carbonTonnes: number;
  utilization: number;
  productiveHours: number;
}

export interface SeriesPoint {
  label: string;
  value: number;
}

export interface OwnerSeries {
  utilization: SeriesPoint[];
  fuel: SeriesPoint[];
  idleCost: SeriesPoint[];
  productivity: SeriesPoint[];
  carbon: SeriesPoint[];
}

export interface TrainingModule {
  id: string;
  title: string;
  /** Percent 0-100. */
  progress: number;
  lessons: number;
  lessonsDone: number;
  /** Short reason the module is recommended now. */
  rationale: string;
  locked: boolean;
}

export interface TimelineMarker {
  id: string;
  /** Epoch millis. */
  at: number;
  severity: AlertSeverity;
  label: string;
  machineId: string;
}

export interface SiteSnapshot {
  /** Epoch millis of this snapshot. */
  t: number;
  clock: string;
  shift: string;
  weather: WeatherMode;
  /** Ambient temperature, Celsius. */
  temperatureC: number;
  machines: Machine[];
  alerts: SiteAlert[];
  tasks: SiteTask[];
  kpis: FleetKpis;
  /** Composite 0-100 working-conditions risk score. */
  riskScore: number;
  activeScenario: string | null;
}

/* --------------------------------------------------------------- director */

export type DirectorScenarioId =
  | "unbuckle"
  | "worker_proximity"
  | "dozer_reversing"
  | "heavy_lift_slope"
  | "rain"
  | "hydraulic_spike"
  | "idle_anomaly"
  | "reset";

export interface DirectorScenario {
  id: DirectorScenarioId;
  label: string;
  group: "Safety" | "Operations" | "Environment" | "Machine health" | "Anomalies" | "System";
  description: string;
  /** Which screen the presenter should be on when firing this. */
  watchOn: string;
  /** Seconds the scenario stays active; 0 means until reset. */
  holdSeconds: number;
  destructive?: boolean;
}

export interface DirectorResult {
  ok: boolean;
  scenario: DirectorScenarioId;
  message: string;
  at: number;
}
