/**
 * Live source backed by the FastAPI hub.
 *
 * It speaks the stream contract from the README: `machine_state` and `event`
 * messages over `/ws/live`, plus the REST endpoints for everything that is not
 * streamed. Anything the backend does not serve yet falls through to the mock
 * so a partially finished backend degrades one panel at a time instead of
 * taking the whole product down.
 */
import type {
  ConnectionState,
  DirectorResult,
  DirectorScenarioId,
  Machine,
  SiteAlert,
  SiteSnapshot,
  TelemetryPoint,
} from "./contracts";
import type { FleetSource } from "./source";
import { MockFleetSource } from "./mock-source";
import { KIND_LABEL } from "./seed";

/** Raw `machine_state` frame, exactly as the stream contract defines it. */
interface MachineStateFrame {
  type: "machine_state";
  machine_id: string;
  model?: string;
  operator_id?: string;
  pos?: { x: number; y: number };
  heading_deg?: number;
  speed_mps?: number;
  engine_hours?: number;
  fuel_level_pct?: number;
  fuel_used_l?: number;
  load_cycles?: number;
  idle_min?: number;
  seatbelt?: "fastened" | "unfastened";
  payload_kg?: number;
  hydraulic_temp_c?: number;
  tip_over_margin?: number;
  task_id?: string;
  task_progress?: number;
}

interface EventFrame {
  type: "event";
  ts: string;
  event: string;
  severity: "high" | "medium" | "low";
  machine_id: string;
  source?: string;
  data?: Record<string, string | number>;
}

type Frame = MachineStateFrame | EventFrame;

const SEVERITY: Record<string, SiteAlert["severity"]> = {
  high: "critical",
  medium: "warning",
  low: "info",
};

export class LiveFleetSource implements FleetSource {
  readonly id = "live" as const;

  /** Backs every read the hub does not serve, and the whole stream until it connects. */
  private fallback = new MockFleetSource();
  private socket: WebSocket | null = null;
  private connection: ConnectionState = "connecting";
  private listeners = new Set<(s: SiteSnapshot) => void>();
  private overrides = new Map<string, Partial<Machine>>();

  constructor(
    private readonly httpBase: string,
    private readonly wsUrl: string,
  ) {}

  start(): void {
    this.fallback.start();
    this.fallback.subscribe((snapshot) => this.emit(this.merge(snapshot)));
    this.connect();
  }

  stop(): void {
    this.socket?.close();
    this.socket = null;
    this.fallback.stop();
  }

  private connect(): void {
    if (typeof WebSocket === "undefined") return;
    try {
      const socket = new WebSocket(this.wsUrl);
      this.socket = socket;
      socket.onopen = () => {
        this.connection = "live";
      };
      socket.onmessage = (e) => this.onFrame(e.data);
      socket.onerror = () => {
        this.connection = "error";
      };
      socket.onclose = () => {
        // Keep showing simulated data rather than an empty screen, and retry.
        this.connection = "simulated";
        this.overrides.clear();
        setTimeout(() => this.connect(), 4000);
      };
    } catch {
      this.connection = "simulated";
    }
  }

  private onFrame(raw: string): void {
    let frame: Frame;
    try {
      frame = JSON.parse(raw) as Frame;
    } catch {
      return;
    }
    if (frame.type === "machine_state") {
      this.overrides.set(frame.machine_id, toMachinePatch(frame));
      this.emit(this.merge(this.fallback.getSnapshot()));
    }
    // `event` frames arrive as alerts through the snapshot merge below.
    if (frame.type === "event") {
      this.events.set(`${frame.event}-${frame.machine_id}`, toAlert(frame));
      this.emit(this.merge(this.fallback.getSnapshot()));
    }
  }

  private events = new Map<string, SiteAlert>();

  /** Overlay whatever the hub has sent on top of the simulated baseline. */
  private merge(base: SiteSnapshot): SiteSnapshot {
    if (this.connection !== "live") return base;
    const machines = base.machines.map((m) => {
      const patch = this.overrides.get(m.id);
      return patch ? { ...m, ...patch } : m;
    });
    const streamed = [...this.events.values()];
    return {
      ...base,
      machines,
      alerts: streamed.length ? streamed : base.alerts,
      kpis: { ...base.kpis, openAlerts: (streamed.length ? streamed : base.alerts).filter((a) => !a.acknowledged).length },
    };
  }

  private emit(snapshot: SiteSnapshot): void {
    this.snapshot = snapshot;
    for (const l of this.listeners) l(snapshot);
  }

  private snapshot: SiteSnapshot = this.fallback.getSnapshot();

  getConnection(): ConnectionState {
    return this.connection;
  }

  getSnapshot(): SiteSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (s: SiteSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getTelemetry(machineId: string): TelemetryPoint[] {
    return this.fallback.getTelemetry(machineId);
  }

  acknowledgeAlert(id: string): void {
    const streamed = this.events.get([...this.events.keys()].find((k) => this.events.get(k)?.id === id) ?? "");
    if (streamed) {
      streamed.acknowledged = true;
      this.emit(this.merge(this.fallback.getSnapshot()));
      return;
    }
    this.fallback.acknowledgeAlert(id);
  }

  acknowledgeAll(): void {
    for (const a of this.events.values()) a.acknowledged = true;
    this.fallback.acknowledgeAll();
  }

  getIncidents() {
    return this.fallback.getIncidents();
  }
  // The hub has no incident-log endpoint yet, so the log is kept locally and
  // the two merge the day it grows one.
  fileIncident(incidentId: string, status: Parameters<FleetSource["fileIncident"]>[1], note?: string) {
    this.fallback.fileIncident(incidentId, status, note);
  }
  reportIncident(input: Parameters<FleetSource["reportIncident"]>[0]) {
    return this.fallback.reportIncident(input);
  }
  getMaintenance() {
    return this.fallback.getMaintenance();
  }
  getAnomalies() {
    return this.fallback.getAnomalies();
  }
  getOwnerKpis() {
    return this.fallback.getOwnerKpis();
  }
  getOwnerSeries() {
    return this.fallback.getOwnerSeries();
  }
  getTrainingModules() {
    return this.fallback.getTrainingModules();
  }
  getTimelineMarkers() {
    return this.fallback.getTimelineMarkers();
  }

  async triggerScenario(id: DirectorScenarioId): Promise<DirectorResult> {
    // Always drive the local simulation too, so the demo is identical whether
    // or not the backend answered.
    const local = this.fallback.triggerScenario(id);
    try {
      const res = await fetch(`${this.httpBase}/api/director/${id}`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      return { ok: true, scenario: id, message: "Scenario dispatched to the simulator.", at: Date.now() };
    } catch {
      return local;
    }
  }
}

function toMachinePatch(f: MachineStateFrame): Partial<Machine> {
  const patch: Partial<Machine> = {};
  if (f.model) patch.model = f.model;
  if (f.pos) patch.position = { x: f.pos.x, z: f.pos.y };
  if (f.heading_deg !== undefined) patch.heading = f.heading_deg;
  if (f.speed_mps !== undefined) patch.speedKmh = Number((f.speed_mps * 3.6).toFixed(1));
  if (f.engine_hours !== undefined) patch.engineHours = f.engine_hours;
  if (f.fuel_level_pct !== undefined) patch.fuel = f.fuel_level_pct;
  if (f.fuel_used_l !== undefined) patch.fuelUsedL = f.fuel_used_l;
  if (f.load_cycles !== undefined) patch.loadCycles = f.load_cycles;
  if (f.idle_min !== undefined) patch.idleMinutes = f.idle_min;
  if (f.seatbelt) patch.seatbelt = f.seatbelt;
  if (f.payload_kg !== undefined) patch.payloadKg = f.payload_kg;
  if (f.hydraulic_temp_c !== undefined) patch.hydraulicTemperature = f.hydraulic_temp_c;
  if (f.tip_over_margin !== undefined) patch.tipOverMargin = f.tip_over_margin;
  if (f.task_id) patch.taskId = f.task_id;
  if (f.task_progress !== undefined) patch.taskProgress = Math.round(f.task_progress * 100);
  return patch;
}

const EVENT_TITLES: Record<string, string> = {
  seatbelt_unfastened: "Seatbelt unfastened",
  proximity_alert: "Person in the danger zone",
  fatigue_alert: "Operator fatigue detected",
  tip_over_warning: "Tip-over margin critical",
  v2v_collision_risk: "Collision risk predicted",
  v2i_suggestion: "Site routing suggestion",
  anomaly_detected: "Unusual machine usage",
  incident_created: "Incident filed",
  maintenance_due: "Maintenance due",
  weather_change: "Weather changing on site",
  task_reordered: "Tasks re-sequenced",
};

function toAlert(f: EventFrame): SiteAlert {
  const detail: Record<string, string> = {};
  for (const [k, v] of Object.entries(f.data ?? {})) detail[k] = String(v);
  return {
    id: `LIVE-${f.event}-${f.machine_id}`,
    kind: (f.event.replace("_alert", "").replace("_warning", "") as SiteAlert["kind"]) ?? "anomaly",
    severity: SEVERITY[f.severity] ?? "warning",
    source: (f.source as SiteAlert["source"]) ?? "simulator",
    machineId: f.machine_id,
    title: EVENT_TITLES[f.event] ?? f.event.replace(/_/g, " "),
    message: `${f.machine_id}: ${f.event.replace(/_/g, " ")}.`,
    cause: "Reported by the site rules engine over the live stream.",
    action: "Review on the command centre and acknowledge once handled.",
    detail,
    createdAt: Date.parse(f.ts) || Date.now(),
    acknowledged: false,
    resolvedAt: null,
  };
}

export { KIND_LABEL };
