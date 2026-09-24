/**
 * In-browser stand-in for the live site.
 *
 * It drifts telemetry once a second, derives alerts from deterministic rules
 * (never from random noise), and applies director scenarios. It exists so the
 * whole product can be built, demoed and rehearsed before the simulator and
 * WebSocket hub are wired in, and so the demo still runs if they go down.
 *
 * Scenario triggers are mirrored over BroadcastChannel, which lets the director
 * panel run in a second tab or on a second screen and still drive this one.
 */
import type {
  Anomaly,
  ConnectionState,
  DirectorResult,
  DirectorScenarioId,
  Incident,
  Machine,
  MaintenanceItem,
  OwnerKpis,
  OwnerSeries,
  ProximityLevel,
  SiteAlert,
  SiteSnapshot,
  SiteTask,
  TelemetryPoint,
  TimelineMarker,
  TrainingModule,
  WeatherMode,
} from "./contracts";
import type { FleetSource } from "./source";
import { ownerKpisFrom, ownerSeries } from "./owner-report";
import {
  JOBS,
  PRIMARY_MACHINE_ID,
  RATED_PAYLOAD,
  SHIFT_LABEL,
  seedAnomalies,
  seedIncidents,
  seedMachines,
  seedMaintenance,
  seedTasks,
  seedTraining,
} from "./seed";
import {
  congestionFrom,
  estimateTask,
  modelCode,
  visibilityFor,
  type SiteConditions,
} from "./estimate";
import {
  ANOMALY_LABEL,
  scoreWindow,
  specFor,
  type AnomalyFinding,
  type TelemetrySample,
} from "@/lib/intel";

const TICK_MS = 1000;
const TELEMETRY_WINDOW = 90;
const CHANNEL = "cat-copilot-director";

/**
 * How much live telemetry the anomaly detector gets to look at.
 *
 * The trained model works on two-hour windows, which is the scale the brief
 * states its patterns at. A demo cannot wait two hours, so the live window is
 * ten minutes. The ratios the rules key off — idle time over elapsed time,
 * cycles per hour, belt-off fraction — are scale-free, so the thresholds carry
 * over unchanged; what shortens is only how long a machine has to misbehave
 * before it is noticed. Ten rather than two because a truck waiting its turn at
 * the loader should not read as an idling machine, and two minutes of queueing
 * is normal.
 */
const ANOMALY_WINDOW_S = 600;
/** Re-scoring every tick would be wasteful; nothing moves that fast. */
const ANOMALY_EVERY_S = 10;
/** Estimates are recomputed on this cadence, not every second. */
const ESTIMATE_EVERY_S = 5;

/** How long each scenario holds before it decays on its own. 0 = until reset. */
const SCENARIO_HOLD: Record<DirectorScenarioId, number> = {
  unbuckle: 0,
  worker_proximity: 26,
  dozer_reversing: 22,
  heavy_lift_slope: 0,
  rain: 0,
  hydraulic_spike: 0,
  idle_anomaly: 0,
  reset: 0,
};

interface ScenarioState {
  /** Epoch millis the scenario started. */
  since: number;
  /** Epoch millis it auto-clears, or null when it holds until reset. */
  until: number | null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function drift(current: number, target: number, rate: number, jitter: number): number {
  return current + (target - current) * rate + (Math.random() - 0.5) * jitter;
}

function clockLabel(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function proximityLevelFor(distance: number | null): ProximityLevel {
  if (distance === null) return "safe";
  if (distance <= 3) return "critical";
  if (distance <= 7) return "warning";
  return "safe";
}

export class MockFleetSource implements FleetSource {
  readonly id = "mock" as const;

  private machines: Machine[] = seedMachines();
  private tasks: SiteTask[] = seedTasks();
  private alerts = new Map<string, SiteAlert>();
  private telemetry = new Map<string, TelemetryPoint[]>();
  private listeners = new Set<(s: SiteSnapshot) => void>();

  private incidents: Incident[];
  private maintenance: MaintenanceItem[] = seedMaintenance();
  private anomalies: Anomaly[];
  private training: TrainingModule[] = seedTraining();

  private scenarios = new Map<DirectorScenarioId, ScenarioState>();
  private weather: WeatherMode = "clear";
  private temperatureC = 34;

  private timer: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private snapshot: SiteSnapshot;
  private startedAt = Date.now();

  /** Raw per-second state, kept only as long as the detector needs it. */
  private windows = new Map<string, TelemetrySample[]>();
  /** Previous tick per machine, so harshness can be measured as a change. */
  private lastSample = new Map<string, { speedKmh: number; payloadKg: number }>();
  /** Live findings, keyed machine+pattern so one condition is one entry. */
  private liveAnomalies = new Map<string, Anomaly>();
  private ticks = 0;
  /** Alert ids already written into the incident log. */
  private logged = new Set<string>();

  constructor() {
    const now = Date.now();
    this.incidents = seedIncidents(now);
    this.anomalies = seedAnomalies(now);
    for (const m of this.machines) this.telemetry.set(m.id, this.primeTelemetry(m, now));
    this.tasks = this.estimateTasks();
    this.snapshot = this.buildSnapshot(now);
  }

  /* ---------------------------------------------------------- conditions */

  /** What the site currently looks like to the task-time model. */
  private conditions(): SiteConditions {
    return {
      weather: this.weather,
      temperatureC: this.temperatureC,
      visibilityM: visibilityFor(this.weather),
      congestion: congestionFrom(this.machines),
      hour: new Date().getHours(),
    };
  }

  /* ------------------------------------------------------------ lifecycle */

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);

    if (typeof BroadcastChannel !== "undefined" && !this.channel) {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (e: MessageEvent<{ scenario?: DirectorScenarioId }>) => {
        const id = e.data?.scenario;
        if (id) this.applyScenario(id);
      };
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.channel?.close();
    this.channel = null;
  }

  getConnection(): ConnectionState {
    return "simulated";
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

  /* --------------------------------------------------------------- reads */

  getTelemetry(machineId: string): TelemetryPoint[] {
    return this.telemetry.get(machineId) ?? [];
  }

  getIncidents(): Incident[] {
    return this.incidents;
  }

  getMaintenance(): MaintenanceItem[] {
    return this.maintenance;
  }

  /**
   * What the detector has found, live findings first.
   *
   * The live ones are this shift; the rest are the same detector's output over
   * the 30-day record. They are the same shape because they come from the same
   * code, which is the point.
   */
  getAnomalies(): Anomaly[] {
    const live = [...this.liveAnomalies.values()].sort((a, b) => b.score - a.score);
    return [...live, ...this.anomalies];
  }

  getTrainingModules(): TrainingModule[] {
    return this.training;
  }

  getTimelineMarkers(): TimelineMarker[] {
    const fromIncidents: TimelineMarker[] = this.incidents.map((i) => ({
      id: i.id,
      at: i.at,
      severity: i.severity,
      label: i.title,
      machineId: i.machineId,
    }));
    const fromAlerts: TimelineMarker[] = [...this.alerts.values()].map((a) => ({
      id: a.id,
      at: a.createdAt,
      severity: a.severity,
      label: a.title,
      machineId: a.machineId,
    }));
    return [...fromIncidents, ...fromAlerts].sort((a, b) => a.at - b.at);
  }

  getOwnerKpis(): OwnerKpis {
    return ownerKpisFrom(this.snapshot);
  }

  getOwnerSeries(): OwnerSeries {
    return ownerSeries();
  }

  /* -------------------------------------------------------------- writes */

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.acknowledged) return;
    this.alerts.set(alertId, { ...alert, acknowledged: true });
    this.publish(Date.now());
  }

  acknowledgeAll(): void {
    let changed = false;
    for (const [id, alert] of this.alerts) {
      if (alert.acknowledged) continue;
      this.alerts.set(id, { ...alert, acknowledged: true });
      changed = true;
    }
    if (changed) this.publish(Date.now());
  }

  async triggerScenario(id: DirectorScenarioId): Promise<DirectorResult> {
    // Modelled as async so swapping in the real POST /api/director/{id} is a
    // one-line change in the live source, not a change of shape here.
    await new Promise((r) => setTimeout(r, 260));
    this.applyScenario(id);
    this.channel?.postMessage({ scenario: id });
    return {
      ok: true,
      scenario: id,
      message: id === "reset" ? "Site returned to nominal." : "Scenario running on the live site.",
      at: Date.now(),
    };
  }

  /* ----------------------------------------------------------- scenarios */

  private applyScenario(id: DirectorScenarioId): void {
    const now = Date.now();

    if (id === "reset") {
      this.scenarios.clear();
      this.machines = seedMachines();
      this.tasks = seedTasks();
      this.alerts.clear();
      this.weather = "clear";
      this.temperatureC = 34;
      this.anomalies = seedAnomalies(now);
      this.liveAnomalies.clear();
      this.windows.clear();
      this.lastSample.clear();
      this.logged.clear();
      for (const m of this.machines) this.telemetry.set(m.id, this.primeTelemetry(m, now));
      this.tasks = this.estimateTasks();
      this.publish(now);
      return;
    }

    const hold = SCENARIO_HOLD[id];
    this.scenarios.set(id, { since: now, until: hold > 0 ? now + hold * 1000 : null });

    if (id === "rain") {
      this.weather = "rain";
      this.temperatureC = 27;
      this.reorderTasksForRain();
    }

    if (id === "idle_anomaly") {
      // Scripted first, real later: rather than posting a finished anomaly to
      // the screen, this puts EXC002 into the state the pattern describes —
      // engine running, operator off the seat, nothing being moved — and lets
      // the detector find it on its next pass. What appears on screen is a
      // detection, which is the only version worth demonstrating.
      this.machines = this.machines.map((m) =>
        m.id === "EXC002"
          ? { ...m, status: "idle", utilization: 6, load: 0, speedKmh: 0, seatbelt: "unfastened" }
          : m,
      );
      // Prime the window so the two minutes of idling the rule needs are
      // already on the record; otherwise the demo waits.
      this.windows.set("EXC002", this.primeIdleWindow(now));
    }

    this.publish(now);
  }

  /**
   * Two minutes of "sat there with the engine running", as the detector would
   * have recorded it.
   *
   * The counters are cumulative and the detector differences them, so idling
   * has to be written as a rising idle count against a flat cycle count — the
   * same shape a real two minutes of it would leave behind.
   */
  private primeIdleWindow(now: number): TelemetrySample[] {
    const m = this.machines.find((x) => x.id === "EXC002");
    if (!m) return [];
    return Array.from({ length: ANOMALY_WINDOW_S }, (_, i) => {
      const age = ANOMALY_WINDOW_S - i;
      return {
        t: now - age * 1000,
        idleMin: m.idleMinutes - age / 60,
        loadCycles: m.loadCycles,
        fuelUsedL: m.fuelUsedL - age * 0.0009,
        payloadKg: 0,
        hydraulicTemperatureC: m.hydraulicTemperature,
        seatbeltOff: true,
        harshSwing: false,
      };
    });
  }

  private activeScenarios(now: number): Set<DirectorScenarioId> {
    const live = new Set<DirectorScenarioId>();
    for (const [id, state] of this.scenarios) {
      if (state.until !== null && now > state.until) {
        this.scenarios.delete(id);
        continue;
      }
      live.add(id);
    }
    return live;
  }

  /**
   * Rain resequences the shift.
   *
   * Only the order changes here. The minutes are left alone deliberately —
   * `weather` is a model feature, so every estimate on site is repriced on the
   * next pass by the model itself. Adding a penalty here as well would be
   * counting the rain twice.
   */
  private reorderTasksForRain(): void {
    this.tasks = this.tasks.map((t) =>
      t.id === "T-EXC001-3"
        ? { ...t, startsAt: "16:30" }
        : t.id === "T-EXC001-2"
          ? { ...t, startsAt: "13:40" }
          : t,
    );
  }

  /* ------------------------------------------------------------ the tick */

  private tick(): void {
    const now = Date.now();
    const active = this.activeScenarios(now);
    this.ticks += 1;

    this.machines = this.machines.map((m) => this.advance(m, active, now));
    this.runRules(active, now);
    this.recordTelemetry(now);
    this.sampleForDetector(now);

    // The detector and the estimator are the expensive parts of the loop, so
    // they run on their own cadence rather than sixty times a minute.
    if (this.ticks % ANOMALY_EVERY_S === 0) this.detectAnomalies(now);
    if (this.ticks % ESTIMATE_EVERY_S === 0) this.tasks = this.estimateTasks();

    this.advanceProgress();
    this.publish(now);
  }

  /* ----------------------------------------------------------- estimates */

  /** Every task re-estimated against the conditions holding right now. */
  private estimateTasks(): SiteTask[] {
    const site = this.conditions();
    const byId = new Map(this.machines.map((m) => [m.id, m]));
    // Progress lives on the running tasks, not on the job definitions.
    const progressById = new Map(this.tasks.map((t) => [t.id, t.progress]));
    const stateById = new Map(this.tasks.map((t) => [t.id, t.state]));
    const startById = new Map(this.tasks.map((t) => [t.id, t.startsAt]));

    return JOBS.map((job) => {
      const machine = byId.get(job.machineId);
      return estimateTask(
        {
          ...job,
          progress: progressById.get(job.id) ?? job.progress,
          state: stateById.get(job.id) ?? job.state,
          startsAt: startById.get(job.id) ?? job.startsAt,
        },
        machine,
        machine?.operator ?? null,
        site,
      );
    });
  }

  /**
   * Move active work along.
   *
   * Progress is driven by the estimate itself — a task with 40 minutes left
   * advances by one minute's worth each minute — so the bar and the countdown
   * can never disagree, which is the thing an operator notices immediately.
   */
  private advanceProgress(): void {
    this.tasks = this.tasks.map((t) => {
      if (t.state !== "active" || t.progress >= 100) return t;
      const machine = this.machines.find((m) => m.id === t.machineId);
      // Nothing progresses while the machine is stopped or alarming.
      if (!machine || machine.status === "offline" || machine.status === "maintenance") return t;

      const remainingMin = Math.max(t.etaMinutes, 0.5);
      const step = (TICK_MS / 60000 / remainingMin) * (100 - t.progress);
      return { ...t, progress: Math.min(100, Number((t.progress + step).toFixed(2))) };
    });
  }

  /* ------------------------------------------------------------ detector */

  /** One second of state per machine, trimmed to the detector's window. */
  private sampleForDetector(now: number): void {
    for (const m of this.machines) {
      if (m.status === "offline") continue;
      const window = this.windows.get(m.id) ?? [];
      const previous = this.lastSample.get(m.id);
      this.lastSample.set(m.id, { speedKmh: m.speedKmh, payloadKg: m.payloadKg });
      window.push({
        t: now,
        idleMin: m.idleMinutes,
        loadCycles: m.loadCycles,
        fuelUsedL: m.fuelUsedL,
        payloadKg: m.payloadKg,
        hydraulicTemperatureC: m.hydraulicTemperature,
        seatbeltOff: m.seatbelt === "unfastened",
        // Harshness is a change, not a state. A machine moving fast under load
        // is a machine working; what marks an operator as rough is the jerk
        // between one moment and the next, so this compares against the
        // previous sample rather than against a speed threshold.
        harshSwing: previous
          ? Math.abs(m.speedKmh - previous.speedKmh) > 2.5 ||
            Math.abs(m.payloadKg - previous.payloadKg) > RATED_PAYLOAD[m.kind] * 0.6
          : false,
      });
      if (window.length > ANOMALY_WINDOW_S) window.splice(0, window.length - ANOMALY_WINDOW_S);
      this.windows.set(m.id, window);
    }
  }

  /**
   * Score every machine's recent window and keep what the detector returns.
   *
   * A finding that stops firing is dropped rather than left on screen: the
   * point of the second layer is that it tracks what is true now, and an
   * anomaly list that only grows is one nobody reads.
   */
  private detectAnomalies(now: number): void {
    const seen = new Set<string>();

    for (const m of this.machines) {
      const window = this.windows.get(m.id);
      if (!window || m.status === "offline") continue;

      // Rules only: see `ScoreOptions.useBaselines` — the historical baselines
      // describe the generated record, not this simulated shift.
      const finding = scoreWindow(m.id, modelCode(m), window, {
        useBaselines: false,
        // Half a window, matching what the Python detector will score.
        minSamples: ANOMALY_WINDOW_S / 2,
      });
      if (!finding) continue;

      const key = `${m.id}:${finding.type}`;
      seen.add(key);
      const existing = this.liveAnomalies.get(key);
      this.liveAnomalies.set(key, {
        ...this.toAnomaly(finding, m, existing?.detectedAt ?? now),
        id: existing?.id ?? `ANO-LIVE-${this.liveAnomalies.size + 1}`,
      });
    }

    for (const key of [...this.liveAnomalies.keys()]) {
      if (!seen.has(key)) this.liveAnomalies.delete(key);
    }
  }

  /** A detector finding in the product's own contract. */
  private toAnomaly(finding: AnomalyFinding, m: Machine, detectedAt: number): Anomaly {
    const spec = specFor(modelCode(m));
    const co = finding.related.length
      ? ` Alongside it: ${finding.related.map((r) => ANOMALY_LABEL[r].toLowerCase()).join(", ")}.`
      : "";

    return {
      id: `ANO-LIVE-${m.id}-${finding.type}`,
      machineId: m.id,
      title: ANOMALY_LABEL[finding.type],
      explanation:
        `${m.id} is ${finding.deviation} over the last ` +
        `${Math.round(finding.features.minutes)} minutes.${co}` +
        (finding.detectedBy === "rules"
          ? " This matches a named pattern in the safety rules."
          : " No single rule fired; the distance from this machine's own normal is what flagged it."),
      deviation: finding.deviation,
      costInr: finding.fuelCostInr,
      detectedAt,
      severity: finding.score >= 0.9 ? "critical" : finding.score >= 0.7 ? "warning" : "info",
      pattern: finding.type,
      related: finding.related,
      score: finding.score,
      detectedBy: finding.detectedBy,
      evidence: {
        Window: `${Math.round(finding.features.minutes)} min`,
        "Idle time": `${finding.evidence.idleMinutes.toFixed(1)} min`,
        "Load cycles": String(finding.evidence.cycles),
        "Belt unfastened": `${finding.evidence.seatbeltOffMinutes.toFixed(1)} min`,
        "Peak payload": `${finding.evidence.peakPayloadKg.toLocaleString("en-IN")} kg`,
        Rated: spec ? `${spec.maxPayloadKg.toLocaleString("en-IN")} kg` : "—",
      },
      fuelWastedL: finding.fuelWastedL,
    };
  }

  private advance(m: Machine, active: Set<DirectorScenarioId>, now: number): Machine {
    if (m.status === "offline") return m;

    const isPrimary = m.id === PRIMARY_MACHINE_ID;
    const working = m.status === "operating";

    let hydraulicTarget = m.status === "maintenance" ? 40 : working ? 72 : 62;
    if (m.id === "EXC002") hydraulicTarget = active.has("hydraulic_spike") ? 108 : 91;

    let tipTarget = m.kind === "excavator" ? 1.62 : 2.4;
    if (isPrimary && active.has("heavy_lift_slope")) tipTarget = 1.14;

    let nearest = m.proximity.nearestPersonM;
    let proxZone = m.proximity.zone;
    if (isPrimary && active.has("worker_proximity")) {
      const held = (now - (this.scenarios.get("worker_proximity")?.since ?? now)) / 1000;
      // Walks in from 9 m, holds at ~2.4 m, then walks back out.
      nearest = held < 6 ? Number((9 - held * 1.1).toFixed(1)) : held < 18 ? 2.4 : Number((2.4 + (held - 18) * 0.9).toFixed(1));
      proxZone = "rear";
    } else if (isPrimary) {
      nearest = null;
      proxZone = null;
    }

    const seatbelt: Machine["seatbelt"] =
      isPrimary && active.has("unbuckle") ? "unfastened" : m.seatbelt === "not_fitted" ? "not_fitted" : "fastened";

    const reversing = m.id === "DOZ001" && active.has("dozer_reversing");
    const speedTarget = reversing ? -3.4 : m.status === "maintenance" ? 0 : working ? Math.abs(m.speedKmh) || 2 : 0;

    const idling = !working && m.status !== "maintenance";
    const idleGrowth = idling ? TICK_MS / 60000 : 0;
    const burn = working ? 0.004 : 0.0009;

    // Cycles are what the productivity rules divide by, so they have to accrue
    // at the machine's real rate rather than sit at their seeded value. The
    // cycle time comes from the same spec table the simulator uses.
    const cycleSeconds = specFor(modelCode(m))?.cycleS ?? 30;
    const cycleGrowth = working && !idling ? TICK_MS / 1000 / cycleSeconds : 0;

    const hydraulicTemperature = Number(drift(m.hydraulicTemperature, hydraulicTarget, 0.05, 0.25).toFixed(1));
    const utilization = Math.round(clamp(drift(m.utilization, working ? m.utilization : 40, 0.02, 1.2), 0, 100));
    const load = Math.round(clamp(drift(m.load, working ? m.load : 0, 0.04, 2), 0, 100));

    return {
      ...m,
      fuel: Number(clamp(m.fuel - burn, 0, 100).toFixed(2)),
      fuelUsedL: Number((m.fuelUsedL + burn * 6.4).toFixed(1)),
      hydraulicTemperature,
      coolantTemperature: Number(drift(m.coolantTemperature, hydraulicTarget + 12, 0.04, 0.3).toFixed(1)),
      tipOverMargin: Number(drift(m.tipOverMargin, tipTarget, 0.09, 0.012).toFixed(2)),
      utilization,
      load,
      payloadKg: Math.round((load / 100) * RATED_PAYLOAD[m.kind]),
      speedKmh: Number(drift(m.speedKmh, speedTarget, 0.14, 0.18).toFixed(1)),
      engineHours: Number((m.engineHours + (working ? TICK_MS / 3_600_000 : 0)).toFixed(3)),
      idleMinutes: Number((m.idleMinutes + idleGrowth).toFixed(2)),
      loadCycles: Number((m.loadCycles + cycleGrowth).toFixed(2)),
      seatbelt,
      proximity: { nearestPersonM: nearest, level: proximityLevelFor(nearest), zone: proxZone },
    };
  }

  /* --------------------------------------------------------------- rules */

  /**
   * Alerts are a pure function of machine state, so they raise and clear
   * themselves and never pile up as duplicates. The real system does this in a
   * deterministic rules engine for the same reason.
   */
  private runRules(active: Set<DirectorScenarioId>, now: number): void {
    const wanted = new Map<string, Omit<SiteAlert, "acknowledged" | "createdAt" | "resolvedAt">>();
    const add = (a: Omit<SiteAlert, "acknowledged" | "createdAt" | "resolvedAt">) => wanted.set(a.id, a);

    for (const m of this.machines) {
      if (m.status === "offline") continue;

      if (m.seatbelt === "unfastened") {
        const held = (now - (this.scenarios.get("unbuckle")?.since ?? now)) / 1000;
        const escalated = held > 12;
        add({
          id: `AL-seatbelt-${m.id}`,
          kind: "seatbelt",
          severity: escalated ? "critical" : "warning",
          source: "rules",
          machineId: m.id,
          title: escalated ? "Seatbelt still unfastened" : "Seatbelt unfastened",
          message: escalated
            ? `${m.id} has been operating unrestrained for ${Math.round(held)} seconds. Travel is locked.`
            : `${m.id} is running with the operator restraint released.`,
          cause: "Buckle switch open while the engine is running and the machine is out of park.",
          action: escalated ? "Stop the machine and fasten the belt to release travel." : "Fasten the seatbelt before moving.",
          detail: { Machine: m.id, Operator: m.operator?.id ?? "Unassigned", Duration: `${Math.round(held)} s` },
        });
      }

      if (m.proximity.level !== "safe" && m.proximity.nearestPersonM !== null) {
        const critical = m.proximity.level === "critical";
        add({
          id: `AL-proximity-${m.id}`,
          kind: "proximity",
          severity: critical ? "critical" : "warning",
          source: "webcam",
          machineId: m.id,
          title: critical ? "Person in the danger zone" : "Person approaching",
          message: `A worker is ${m.proximity.nearestPersonM.toFixed(1)} m ${m.proximity.zone ?? "near"} of ${m.id}.`,
          cause: "Camera person detection and UWB tag agree on a position inside the swing envelope.",
          action: critical ? "Stop all slew and travel until the area is clear." : "Hold the swing and confirm the worker is clear.",
          detail: {
            Distance: `${m.proximity.nearestPersonM.toFixed(1)} m`,
            Zone: m.proximity.zone ?? "unknown",
            Detection: "Camera + UWB",
          },
        });
      }

      if (m.tipOverMargin < 1.5 && m.kind === "excavator") {
        const critical = m.tipOverMargin < 1.2;
        add({
          id: `AL-tipover-${m.id}`,
          kind: "tip_over",
          severity: critical ? "critical" : "warning",
          source: "simulator",
          machineId: m.id,
          title: critical ? "Tip-over margin critical" : "Stability margin reduced",
          message: `${m.id} stability margin is ${m.tipOverMargin.toFixed(2)} against a 1.20 limit.`,
          cause: "Payload at extended reach combined with cross-slope under the tracks.",
          action: critical ? "Retract the stick and lower the boom now." : "Bring the load closer in before continuing.",
          detail: {
            Margin: m.tipOverMargin.toFixed(2),
            Payload: `${m.payloadKg.toLocaleString("en-IN")} kg`,
            Limit: "1.20",
          },
        });
      }

      if (m.hydraulicTemperature >= 100) {
        add({
          id: `AL-hydraulic-${m.id}`,
          kind: "hydraulic",
          severity: m.hydraulicTemperature >= 105 ? "critical" : "warning",
          source: "ml",
          machineId: m.id,
          title: "Hydraulic temperature high",
          message: `${m.id} hydraulic oil is at ${m.hydraulicTemperature.toFixed(0)} °C against a 98 °C ceiling.`,
          cause: "Oil temperature has risen for 6 consecutive minutes with no drop in duty cycle.",
          action: "Reduce duty cycle and raise a work order for a cooler and oil check.",
          detail: {
            Temperature: `${m.hydraulicTemperature.toFixed(0)} °C`,
            Ceiling: "98 °C",
            "Service due": "18 engine hours",
          },
        });
      }

      if (m.fuel < 20 && m.status !== "maintenance") {
        add({
          id: `AL-fuel-${m.id}`,
          kind: "fuel",
          severity: m.fuel < 12 ? "warning" : "info",
          source: "simulator",
          machineId: m.id,
          title: "Fuel low",
          message: `${m.id} is at ${m.fuel.toFixed(0)}% fuel.`,
          cause: "Consumption rate projects a dry tank before the end of shift.",
          action: "Route to the fuel bay at the next cycle break.",
          detail: { Level: `${m.fuel.toFixed(0)}%`, Bay: "Fuel bay, 240 m" },
        });
      }
    }

    if (active.has("dozer_reversing")) {
      add({
        id: "AL-collision-DOZ001",
        kind: "collision",
        severity: "critical",
        source: "v2v",
        machineId: "DOZ001",
        title: "Reverse conflict predicted",
        message: "DOZ001 is reversing toward EXC001. Predicted conflict in 3.2 seconds.",
        cause: "V2V path extrapolation puts both machines inside an 11 m conflict radius.",
        action: "DOZ001 must stop reversing. EXC001 hold position.",
        detail: { "Time to conflict": "3.2 s", Separation: "14 m", Machines: "DOZ001 + EXC001" },
      });
    }

    if (active.has("rain")) {
      add({
        id: "AL-weather",
        kind: "weather",
        severity: "warning",
        source: "simulator",
        machineId: "SITE",
        title: "Rain moving onto site",
        message: "Rain is expected to persist for the rest of the shift. Ground conditions are degrading.",
        cause: "Site weather station reports falling pressure and 4 mm/h precipitation.",
        action: "Backfill deferred to 16:30. Reduce haul road speeds to 15 km/h.",
        detail: { Precipitation: "4 mm/h", Visibility: "1.8 km", "Risk score": "+18" },
      });
    }

    // Raise anything new, keep createdAt/ack state for anything still true,
    // and drop alerts whose condition has cleared.
    for (const [id, next] of wanted) {
      const existing = this.alerts.get(id);
      const alert: SiteAlert = {
        ...next,
        createdAt: existing?.createdAt ?? now,
        // Re-arm acknowledgement when an alert escalates in severity.
        acknowledged: existing && existing.severity === next.severity ? existing.acknowledged : false,
        resolvedAt: null,
      };
      this.alerts.set(id, alert);
      this.logIncident(alert, now);
    }
    for (const id of [...this.alerts.keys()]) {
      if (!wanted.has(id)) this.alerts.delete(id);
    }

    const byMachine = new Map<string, string[]>();
    for (const a of this.alerts.values()) {
      byMachine.set(a.machineId, [...(byMachine.get(a.machineId) ?? []), a.id]);
    }
    this.machines = this.machines.map((m) => {
      const ids = byMachine.get(m.id) ?? [];
      const severities = ids.map((id) => this.alerts.get(id)?.severity);
      const status: Machine["status"] =
        m.status === "offline" || m.status === "maintenance"
          ? m.status
          : severities.includes("critical")
            ? "critical"
            : severities.includes("warning")
              ? "warning"
              : m.utilization < 55
                ? "idle"
                : "operating";
      return { ...m, alertIds: ids, status };
    });
  }

  /* ------------------------------------------------------ incident log */

  /** Alert kinds that constitute a reportable incident when they go critical. */
  private static readonly REPORTABLE: SiteAlert["kind"][] = [
    "proximity",
    "collision",
    "seatbelt",
    "tip_over",
    "fatigue",
  ];

  /**
   * Write a critical safety alert into the incident log.
   *
   * Logging happens once per alert, at the moment it becomes critical — not
   * when it clears. An incident that is only recorded after the fact is the
   * failure mode this is meant to fix: the operator moves on, nobody files
   * anything, and the near miss never existed. The record captures who was in
   * the seat, where the machine was and what the weather was doing, because
   * that is what a review asks for and what nobody remembers an hour later.
   */
  private logIncident(alert: SiteAlert, now: number): void {
    if (alert.severity !== "critical") return;
    if (!MockFleetSource.REPORTABLE.includes(alert.kind)) return;
    if (this.logged.has(alert.id)) return;

    const machine = this.machines.find((m) => m.id === alert.machineId);
    this.logged.add(alert.id);

    this.incidents = [
      {
        id: `INC-${String(now % 100000).padStart(5, "0")}`,
        machineId: alert.machineId,
        title: alert.title,
        kind: alert.kind,
        severity: alert.severity,
        at: now,
        zone: machine?.zone ?? "Site",
        summary: `${alert.message} ${alert.cause}`,
        replayable: false,
        // Filed, not reviewed: a supervisor still has to look at it.
        status: "draft",
        operatorId: machine?.operator?.id ?? null,
        operatorName: machine?.operator?.name ?? null,
        weather: this.weather,
        position: machine ? machine.position : null,
        alertId: alert.id,
        note: null,
        automatic: true,
      },
      ...this.incidents,
    ];
  }

  /** A supervisor's note and status change on a logged incident. */
  fileIncident(incidentId: string, status: Incident["status"], note?: string): void {
    this.incidents = this.incidents.map((i) =>
      i.id === incidentId ? { ...i, status, note: note ?? i.note } : i,
    );
    this.publish(Date.now());
  }

  /** An incident raised by a person rather than by a rule. */
  reportIncident(input: {
    machineId: string;
    kind: SiteAlert["kind"];
    severity: SiteAlert["severity"];
    title: string;
    summary: string;
  }): Incident {
    const now = Date.now();
    const machine = this.machines.find((m) => m.id === input.machineId);
    const incident: Incident = {
      id: `INC-${String(now % 100000).padStart(5, "0")}`,
      machineId: input.machineId,
      title: input.title,
      kind: input.kind,
      severity: input.severity,
      at: now,
      zone: machine?.zone ?? "Site",
      summary: input.summary,
      replayable: false,
      status: "draft",
      operatorId: machine?.operator?.id ?? null,
      operatorName: machine?.operator?.name ?? null,
      weather: this.weather,
      position: machine ? machine.position : null,
      alertId: null,
      note: null,
      automatic: false,
    };
    this.incidents = [incident, ...this.incidents];
    this.publish(now);
    return incident;
  }

  /* ----------------------------------------------------------- telemetry */

  private primeTelemetry(m: Machine, now: number): TelemetryPoint[] {
    return Array.from({ length: 40 }, (_, i) => {
      const t = now - (40 - i) * TICK_MS;
      const wave = Math.sin(i / 5);
      return {
        t,
        label: clockLabel(t),
        fuel: Number((m.fuel + (40 - i) * 0.004).toFixed(2)),
        hydraulicTemperature: Number((m.hydraulicTemperature + wave * 1.6).toFixed(1)),
        tipOverMargin: Number((m.tipOverMargin + wave * 0.04).toFixed(2)),
        utilization: Math.round(clamp(m.utilization + wave * 4, 0, 100)),
        speedKmh: Number(Math.max(0, m.speedKmh + wave * 0.5).toFixed(1)),
      };
    });
  }

  private recordTelemetry(now: number): void {
    for (const m of this.machines) {
      const series = this.telemetry.get(m.id) ?? [];
      series.push({
        t: now,
        label: clockLabel(now),
        fuel: m.fuel,
        hydraulicTemperature: m.hydraulicTemperature,
        tipOverMargin: m.tipOverMargin,
        utilization: m.utilization,
        speedKmh: Math.abs(m.speedKmh),
      });
      if (series.length > TELEMETRY_WINDOW) series.splice(0, series.length - TELEMETRY_WINDOW);
      this.telemetry.set(m.id, series);
    }
  }

  /* ------------------------------------------------------------ snapshot */

  private buildSnapshot(now: number): SiteSnapshot {
    const alerts = [...this.alerts.values()].sort((a, b) => {
      const rank = { critical: 0, warning: 1, info: 2 };
      return rank[a.severity] - rank[b.severity] || b.createdAt - a.createdAt;
    });

    const onSite = this.machines.filter((m) => m.status !== "offline");
    const active = onSite.filter((m) => m.status === "operating" || m.status === "warning" || m.status === "critical");
    const atRisk = onSite.filter((m) => m.status === "warning" || m.status === "critical");
    const utilization = onSite.length
      ? Math.round(onSite.reduce((sum, m) => sum + m.utilization, 0) / onSite.length)
      : 0;

    const scenarioIds = [...this.scenarios.keys()];

    return {
      t: now,
      clock: clockLabel(now),
      shift: SHIFT_LABEL,
      weather: this.weather,
      temperatureC: this.temperatureC,
      machines: this.machines,
      alerts,
      tasks: this.tasks,
      kpis: {
        fleetSize: this.machines.length,
        active: active.length,
        atRisk: atRisk.length,
        openAlerts: alerts.filter((a) => !a.acknowledged).length,
        utilization,
        fuelUsedL: Math.round(this.machines.reduce((sum, m) => sum + m.fuelUsedL, 0) + 17_900),
      },
      riskScore: this.riskScore(),
      activeScenario: scenarioIds.length ? scenarioIds[scenarioIds.length - 1] : null,
    };
  }

  /** Working-conditions score, 0 (safe) to 100 (stop work). */
  private riskScore(): number {
    let score = 14;
    if (this.weather === "rain") score += 18;
    if (this.weather === "fog") score += 22;
    if (this.temperatureC > 36) score += 10;
    const hoursIn = (Date.now() - this.startedAt) / 3_600_000;
    score += Math.min(12, hoursIn * 2);
    for (const a of this.alerts.values()) {
      score += a.severity === "critical" ? 14 : a.severity === "warning" ? 6 : 1;
    }
    return Math.round(clamp(score, 0, 100));
  }

  private publish(now: number): void {
    this.snapshot = this.buildSnapshot(now);
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
