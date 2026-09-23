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

const TICK_MS = 1000;
const TELEMETRY_WINDOW = 90;
const CHANNEL = "cat-copilot-director";

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

  constructor() {
    const now = Date.now();
    this.incidents = seedIncidents(now);
    this.anomalies = seedAnomalies(now);
    for (const m of this.machines) this.telemetry.set(m.id, this.primeTelemetry(m, now));
    this.snapshot = this.buildSnapshot(now);
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

  getAnomalies(): Anomaly[] {
    return this.anomalies;
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
      for (const m of this.machines) this.telemetry.set(m.id, this.primeTelemetry(m, now));
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

    if (id === "idle_anomaly" && !this.anomalies.some((a) => a.id === "ANO-LIVE")) {
      this.anomalies = [
        {
          id: "ANO-LIVE",
          machineId: "EXC002",
          title: "Idle spike with belt unfastened",
          explanation:
            "EXC002 has idled for 19 consecutive minutes with the seatbelt reading unfastened and zero load cycles. This is the same correlated pattern seen in the historic telemetry: the operator is off the seat with the engine running.",
          deviation: "+41% idle vs baseline",
          costInr: 3_260,
          detectedAt: now,
          severity: "warning",
        },
        ...this.anomalies,
      ];
    }

    this.publish(now);
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

  private reorderTasksForRain(): void {
    // Rain pushes the open trench to the front and defers the backfill, which
    // is what the planner service will do for real once it is connected.
    const backfill = this.tasks.find((t) => t.id === "T-EXC001-3");
    if (!backfill) return;
    this.tasks = this.tasks.map((t) =>
      t.id === "T-EXC001-3"
        ? { ...t, startsAt: "16:30", etaMinutes: t.etaMinutes + 14, reasons: ["Deferred: rain after 15:00", ...t.reasons] }
        : t.id === "T-EXC001-2"
          ? { ...t, startsAt: "13:40", reasons: ["Pulled forward ahead of rain", ...t.reasons.slice(0, 1)] }
          : t,
    );
  }

  /* ------------------------------------------------------------ the tick */

  private tick(): void {
    const now = Date.now();
    const active = this.activeScenarios(now);

    this.machines = this.machines.map((m) => this.advance(m, active, now));
    this.runRules(active, now);
    this.recordTelemetry(now);
    this.publish(now);
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

    const idleGrowth = working ? 0 : m.status === "maintenance" ? 0 : TICK_MS / 60000;
    const burn = working ? 0.004 : 0.0009;

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
      idleMinutes: Number((m.idleMinutes + idleGrowth).toFixed(1)),
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
      this.alerts.set(id, {
        ...next,
        createdAt: existing?.createdAt ?? now,
        // Re-arm acknowledgement when an alert escalates in severity.
        acknowledged: existing && existing.severity === next.severity ? existing.acknowledged : false,
        resolvedAt: null,
      });
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
