/**
 * Live source backed by the FastAPI hub.
 *
 * It does not open a socket of its own. It joins the one shared `StreamClient`
 * in `web/lib/stream` — the same connection and the same store the twin and the
 * dev pages use — so every surface in the product is reading byte-identical
 * state. That client already handles the hub handshake, the initial snapshot,
 * epoch changes, rseq resume and reconnect backoff, and it is covered by the
 * node test suite; none of that is worth reimplementing here.
 *
 * What this class adds is the mapping from hub contract shapes to the product's
 * domain contracts, layered over `MockFleetSource` as a baseline. Anything the
 * hub does not stream (incidents, maintenance, owner KPIs, training, telemetry
 * history) still comes from the mock, so a partially finished backend degrades
 * one panel at a time instead of taking the product down.
 *
 * Rule inherited from the stream client: never invent a value. A field is
 * overlaid only when the contract actually carries it; everything else stays on
 * the simulated baseline.
 */
import {
  acquireStream,
  apiBase,
  getStreamStore,
  type LiveEvent,
  type Machine as HubMachine,
  type StreamState,
  type StreamStatus,
} from "@web/lib/stream";
import type {
  AlertKind,
  AlertSeverity,
  AlertSource,
  ConnectionState,
  DirectorResult,
  DirectorScenarioId,
  Machine,
  MachineStatus,
  ProximityLevel,
  SiteAlert,
  SiteSnapshot,
  TelemetryPoint,
} from "./contracts";
import type { FleetSource } from "./source";
import { MockFleetSource } from "./mock-source";
import { KIND_LABEL } from "./seed";
import {
  LIVE_TASK_ID,
  fetchRealAnomalies,
  fetchRealMaintenance,
  fetchRealOwnerReport,
  fetchRealTaskEstimate,
  type RealOwnerReport,
  type RealTaskEstimate,
} from "./real-ml";
import type { Anomaly, Incident, MaintenanceItem, OwnerKpis, OwnerSeries, SiteTask } from "./contracts";

/** How often to re-poll the real ML endpoints. None of this rides the WebSocket stream. */
const ML_REFRESH_MS = 90_000;

/* ------------------------------------------------------------------ mapping */

const SEVERITY: Record<LiveEvent["severity"], AlertSeverity> = {
  critical: "critical",
  high: "critical",
  medium: "warning",
  low: "info",
  info: "info",
};

/** Hub machine status -> product status. Alert-driven escalation is applied separately. */
const STATUS: Record<HubMachine["status"], MachineStatus> = {
  working: "operating",
  travelling: "operating",
  idle: "idle",
  off: "offline",
};

const KIND: Record<HubMachine["machine_type"], Machine["kind"]> = {
  excavator: "excavator",
  wheel_loader: "loader",
  dozer: "dozer",
  truck: "truck",
  grader: "grader",
};

/** The hub's own `bubble` is the authoritative proximity band; distance is informational. */
const BUBBLE: Record<NonNullable<HubMachine["bubble"]>, ProximityLevel> = {
  green: "safe",
  amber: "warning",
  red: "critical",
};

const EVENT_TITLES: Record<string, string> = {
  seatbelt_unfastened: "Seatbelt unfastened",
  proximity_alert: "Person in the danger zone",
  fatigue_alert: "Operator fatigue detected",
  tip_over_warning: "Tip-over margin critical",
  v2v_collision_risk: "Collision risk predicted",
  v2i_suggestion: "Site routing suggestion",
  hydraulic_overheat: "Hydraulic oil overheating",
  anomaly_detected: "Unusual machine usage",
  incident_created: "Incident filed",
  work_order_created: "Work order raised",
  maintenance_due: "Maintenance due",
  weather_change: "Weather changing on site",
  task_reordered: "Tasks re-sequenced",
  source_changed: "Data source changed",
};

/** Map an event name onto the product's alert taxonomy. */
function alertKind(event: string): AlertKind {
  if (event.startsWith("seatbelt")) return "seatbelt";
  if (event.startsWith("proximity")) return "proximity";
  if (event.startsWith("fatigue")) return "fatigue";
  if (event.startsWith("tip_over")) return "tip_over";
  if (event.startsWith("v2v")) return "collision";
  if (event.includes("hydraulic") || event.includes("overheat")) return "hydraulic";
  if (event.includes("maintenance") || event.includes("work_order")) return "maintenance";
  if (event.includes("fuel")) return "fuel";
  if (event.includes("weather")) return "weather";
  return "anomaly";
}

const ALERT_SOURCES: AlertSource[] = ["simulator", "webcam", "v2v", "rules", "ml", "director"];

function alertSource(source: LiveEvent["source"]): AlertSource {
  if (source === "scenario") return "director";
  if (source === "v2i") return "v2v";
  return (ALERT_SOURCES as string[]).includes(source) ? (source as AlertSource) : "rules";
}

function toAlert(e: LiveEvent, acknowledged: boolean): SiteAlert {
  const detail: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.data ?? {})) {
    if (v !== null && typeof v !== "object") detail[k] = String(v);
  }
  if (e.protocol?.regulation) detail.Regulation = e.protocol.regulation.citation;
  return {
    id: e.id,
    kind: alertKind(e.event),
    severity: SEVERITY[e.severity] ?? "warning",
    source: alertSource(e.source),
    machineId: e.machine_id ?? "",
    title: e.protocol?.title ?? EVENT_TITLES[e.event] ?? e.event.replace(/_/g, " "),
    // The hub writes a real message for every event; use it rather than a template.
    message: e.message,
    cause: e.stale
      ? "Reported by the site rules engine (this reading is stale)."
      : `Reported by ${e.source} over the live stream.`,
    // Protocol steps are attached deterministically by the hub and quoted verbatim
    // from the site manuals, so the first step is the correct next action.
    action: e.protocol?.steps?.[0] ?? "Review on the command centre and acknowledge once handled.",
    detail,
    createdAt: Date.parse(e.ts) || Date.now(),
    acknowledged,
    resolvedAt: null,
  };
}

/** Overlay only the fields the contract actually carries. */
function toMachinePatch(m: HubMachine): Partial<Machine> {
  const patch: Partial<Machine> = {
    status: STATUS[m.status],
    position: { x: m.pos.x, z: m.pos.y },
    heading: m.heading_deg,
    speedKmh: Number((m.speed_mps * 3.6).toFixed(1)),
    engineHours: m.engine_hours,
    fuel: m.fuel_level_pct,
    fuelUsedL: m.fuel_used_l,
    loadCycles: m.load_cycles,
    idleMinutes: m.idle_min,
    seatbelt: m.seatbelt,
    payloadKg: m.payload_kg,
    hydraulicTemperature: m.hydraulic_temp_c,
    coolantTemperature: m.coolant_temp_c,
    tipOverMargin: m.tip_over_margin,
    taskProgress: Math.round(m.task_progress * 100),
    proximity: {
      nearestPersonM: Number.isFinite(m.nearest_person_m) ? m.nearest_person_m : null,
      level: BUBBLE[m.bubble] ?? "safe",
      zone: null, // the contract carries distance and band, not a bearing
    },
  };
  if (m.model) patch.model = m.model;
  if (m.machine_type) {
    patch.kind = KIND[m.machine_type];
    patch.kindLabel = KIND_LABEL[KIND[m.machine_type]];
  }
  if (m.zone) patch.zone = m.zone;
  if (m.task_id) patch.taskId = m.task_id;
  return patch;
}

/** connecting/live/simulated/error, honestly: "live" only while frames are actually arriving. */
const CONNECTION: Record<StreamStatus, ConnectionState> = {
  idle: "connecting",
  connecting: "connecting",
  live: "live",
  // The socket is up but the source went quiet, or it is down entirely. Either way what
  // the screens are showing is mostly the simulated baseline, so say so.
  stale: "simulated",
  offline: "simulated",
};

/* ------------------------------------------------------------------- source */

export class LiveFleetSource implements FleetSource {
  readonly id = "live" as const;

  /** Backs every read the hub does not stream, and the whole site until the first snapshot. */
  private fallback = new MockFleetSource();
  private listeners = new Set<(s: SiteSnapshot) => void>();
  private acknowledged = new Set<string>();
  private release: (() => void) | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeMock: (() => void) | null = null;
  private snapshot: SiteSnapshot;

  // Real ML results. `null` means "nothing real yet" — getters fall back to the
  // mock baseline until a fetch succeeds, and keep the last good result if a
  // later refresh fails rather than reverting to the mock underneath the user.
  private realAnomalies: Anomaly[] | null = null;
  private realMaintenance: MaintenanceItem[] | null = null;
  private realOwnerReport: RealOwnerReport | null = null;
  private taskEstimates = new Map<string, RealTaskEstimate>();
  private fetchingTasks = new Set<string>();
  private mlTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly httpBase: string = apiBase(),
    /** Accepted for compatibility; the shared client owns the socket URL. */
    _wsUrl?: string,
  ) {
    void _wsUrl;
    this.snapshot = this.fallback.getSnapshot();
  }

  start(): void {
    this.fallback.start();
    this.unsubscribeMock = this.fallback.subscribe(() => this.recompute());
    if (typeof window === "undefined") return; // SSR: baseline only, no socket
    this.release = acquireStream();
    this.unsubscribeStore = getStreamStore().subscribe(() => this.recompute());
    this.recompute();
    void this.refreshMl();
    this.mlTimer = setInterval(() => void this.refreshMl(), ML_REFRESH_MS);
  }

  stop(): void {
    this.unsubscribeStore?.();
    this.unsubscribeMock?.();
    this.release?.();
    this.unsubscribeStore = this.unsubscribeMock = this.release = null;
    if (this.mlTimer) clearInterval(this.mlTimer);
    this.mlTimer = null;
    this.fallback.stop();
  }

  /** Polls the real anomaly, maintenance and owner-report endpoints. Fail-soft per field. */
  private async refreshMl(): Promise<void> {
    const [anomalies, maintenance, owner] = await Promise.all([
      fetchRealAnomalies(this.httpBase),
      fetchRealMaintenance(this.httpBase),
      fetchRealOwnerReport(this.httpBase),
    ]);
    let changed = false;
    if (anomalies) {
      this.realAnomalies = anomalies;
      changed = true;
    }
    if (maintenance) {
      this.realMaintenance = maintenance;
      changed = true;
    }
    if (owner) {
      this.realOwnerReport = owner;
      changed = true;
    }
    if (changed) this.touch();
  }

  /**
   * Fetches a real task-time estimate the first time a live task_id is seen.
   * The simulator's own task ids ("T-0001") are the only shape the model
   * accepts; a machine on a task the mock invented has no such id and is left
   * on its seeded estimate.
   */
  private maybeFetchTaskEstimate(taskId: string | null): void {
    if (!taskId || !LIVE_TASK_ID.test(taskId)) return;
    if (this.taskEstimates.has(taskId) || this.fetchingTasks.has(taskId)) return;
    this.fetchingTasks.add(taskId);
    void fetchRealTaskEstimate(this.httpBase, taskId).then((est) => {
      this.fetchingTasks.delete(taskId);
      if (!est) return;
      this.taskEstimates.set(taskId, est);
      this.touch();
    });
  }

  /** Bumps the snapshot's identity so useSyncExternalStore-based hooks see the update. */
  private touch(): void {
    this.snapshot = { ...this.snapshot };
    for (const l of this.listeners) l(this.snapshot);
  }

  private recompute(): void {
    const next = this.merge(this.fallback.getSnapshot(), getStreamStore().getState());
    this.snapshot = next;
    for (const l of this.listeners) l(next);
  }

  /** Overlay whatever the hub has streamed on top of the simulated baseline. */
  private merge(base: SiteSnapshot, s: StreamState): SiteSnapshot {
    const hasLiveState = Object.keys(s.machines).length > 0;
    if (!hasLiveState && s.activeAlerts.length === 0) return base;

    const alerts: SiteAlert[] = s.activeAlerts
      .map((e) => toAlert(e, this.acknowledged.has(e.id)))
      .sort((a, b) => b.createdAt - a.createdAt);

    // Which open alerts belong to which machine, so cards can escalate their status.
    const byMachine = new Map<string, SiteAlert[]>();
    for (const a of alerts) {
      if (!a.machineId || a.resolvedAt !== null) continue;
      const list = byMachine.get(a.machineId);
      if (list) list.push(a);
      else byMachine.set(a.machineId, [a]);
    }

    const machines = base.machines.map((m) => {
      const hub = s.machines[m.id];
      const open = byMachine.get(m.id) ?? [];
      if (!hub && open.length === 0) return m;
      const next: Machine = hub ? { ...m, ...toMachinePatch(hub) } : { ...m };
      next.alertIds = open.map((a) => a.id);
      // A machine sitting under an open critical alert is not "operating".
      if (next.status !== "offline" && next.status !== "maintenance") {
        if (open.some((a) => a.severity === "critical")) next.status = "critical";
        else if (open.some((a) => a.severity === "warning")) next.status = "warning";
      }
      if (hub) this.maybeFetchTaskEstimate(next.taskId ?? null);
      return next;
    });

    const effective = hasLiveState || alerts.length > 0 ? alerts : base.alerts;
    return {
      ...base,
      machines,
      tasks: this.overlayTaskEstimates(base.tasks, machines),
      alerts: effective,
      kpis: { ...base.kpis, openAlerts: effective.filter((a) => !a.acknowledged).length },
    };
  }

  /** Replaces a machine's active task's ETA and reasons with the real model's output, when we have it. */
  private overlayTaskEstimates(tasks: SiteTask[], machines: Machine[]): SiteTask[] {
    if (this.taskEstimates.size === 0) return tasks;
    const machineById = new Map(machines.map((m) => [m.id, m]));
    return tasks.map((t) => {
      if (t.state !== "active") return t;
      const machine = machineById.get(t.machineId);
      const est = machine?.taskId ? this.taskEstimates.get(machine.taskId) : undefined;
      if (!est) return t;
      return { ...t, title: est.title, zone: est.zone, progress: est.progress, etaMinutes: est.etaMinutes,
        etaRange: est.etaRange, reasons: est.reasons.length ? est.reasons : t.reasons };
    });
  }

  getConnection(): ConnectionState {
    if (typeof window === "undefined") return "connecting";
    return CONNECTION[getStreamStore().getState().status] ?? "connecting";
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
    if (this.snapshot.alerts.some((a) => a.id === id)) {
      this.acknowledged.add(id);
      this.recompute();
      return;
    }
    this.fallback.acknowledgeAlert(id);
  }

  acknowledgeAll(): void {
    for (const a of this.snapshot.alerts) this.acknowledged.add(a.id);
    this.fallback.acknowledgeAll();
    this.recompute();
  }

  getIncidents() {
    return this.fallback.getIncidents();
  }
  // Incidents are held client-side in both modes, so filing and reporting go
  // to the same store `getIncidents` reads from.
  fileIncident(incidentId: string, status: Incident["status"], note?: string) {
    this.fallback.fileIncident(incidentId, status, note);
  }
  reportIncident(input: Parameters<FleetSource["reportIncident"]>[0]) {
    return this.fallback.reportIncident(input);
  }
  getMaintenance(): MaintenanceItem[] {
    return this.realMaintenance ?? this.fallback.getMaintenance();
  }
  getAnomalies(): Anomaly[] {
    return this.realAnomalies ?? this.fallback.getAnomalies();
  }
  getOwnerKpis(): OwnerKpis {
    return { ...this.fallback.getOwnerKpis(), ...this.realOwnerReport?.kpis };
  }
  getOwnerSeries(): OwnerSeries {
    return { ...this.fallback.getOwnerSeries(), ...this.realOwnerReport?.series };
  }
  getTrainingModules() {
    return this.fallback.getTrainingModules();
  }
  getTimelineMarkers() {
    return this.fallback.getTimelineMarkers();
  }

  async triggerScenario(id: DirectorScenarioId): Promise<DirectorResult> {
    // Drive the local simulation too, so the demo behaves the same whether or not
    // the hub answered.
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

export { KIND_LABEL };
