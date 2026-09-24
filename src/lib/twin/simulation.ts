/**
 * The simulation engine.
 *
 * Owns every mutable piece of world state and advances it one frame at a time.
 * It is plain TypeScript — no React, no Three.js — so the exact same tick would
 * run on a server or in a worker.
 *
 * The 3D layer never writes here. It reads `telemetryOf(id)` (stable object
 * identities, mutated in place) inside `useFrame`, which is what keeps sixty
 * frames a second from turning into sixty React renders a second.
 *
 * Physics: the local fleet runs on a Rapier rigid-body world
 * (`physics/world.ts`), stepped inside `step()` alongside the telemetry tick.
 * It loads asynchronously and only ever runs for locally simulated machines:
 * with the live simulator attached (`source === "websocket"`) or a recorded
 * incident replaying, the world is simply not stepped, and those paths behave
 * exactly as they did before physics existed.
 */

import type {
  Alert,
  AlertSeverity,
  CollisionRisk,
  MachineDescriptor,
  MachineTelemetry,
  ProximityLevel,
  ProximityResult,
  SimEvent,
  SiteTask,
  SiteWorker,
  TelemetrySource,
  VehicleInput,
  WeatherMode,
} from "@/types/twin";
import {
  DUMP_POINT,
  EMPTY_ROUTE,
  LOADER_POINT,
  STOCKPILE_POINT,
  EXCAVATOR_HOME,
  SITE_HALF,
  WORKER_ROUTES,
  type Waypoint,
  angleDelta,
  clamp,
  headingTo,
  headingVector,
  lerp,
  normalizeHeading,
  zoneAt,
} from "./site";
import { type Agent, type FleetRole, type FleetWorld, initialPlacement, stepAgent } from "./fleet";
import { sampleAttitude, terrainHeight } from "./terrain";
import {
  DEG,
  MAX_PAYLOAD,
  MockTelemetryProvider,
  computeTipOverMargin,
  createTelemetry,
  tipOverLevel,
} from "./telemetry";
import {
  TUNING,
  VehicleModel,
  damp,
  steerToward,
  type StepContext,
} from "./vehicle";
import { WebSocketTelemetryProvider } from "./websocketProvider";
import type { LinkStatus } from "@/types/twin";
import { detectCollisionRisks, predictPath } from "./collision";
import {
  getHealth,
  getMachine,
  getRollup,
  dataset,
  replays,
  type IncidentTrack,
} from "@/lib/data/dataset";
import { PhysicsWorld, type PhysicsStats } from "./physics/world";
import { ScenarioRunner } from "./physics/scenarios/runner";
import { PHYSICS_SCENARIOS, getPhysicsScenario } from "./physics/scenarios/library";
import type { ScenarioStatus } from "./physics/scenarios/types";
import {
  PROXIMITY,
  evaluateProximity,
  proximityFromDistances,
  levelRank,
  proximityLevel,
  worstLevel,
} from "./proximity";
import type { PredictedPath } from "@/types/twin";

export const PRIMARY_MACHINE = "EXC001";

/**
 * The four machines the twin renders, drawn from the real roster in
 * `machines.csv`. Models come from the dataset so the HUD can never disagree
 * with the fleet records; operators are the certified ones from operators.csv.
 */
const FLEET: {
  id: string;
  kind: MachineDescriptor["kind"];
  operatorId: string;
  role: FleetRole | "hero";
}[] = [
  // The same nine machines, with the same roles, as simulator/config.py.
  { id: "EXC001", kind: "excavator", operatorId: "OP1002", role: "hero" },
  { id: "EXC002", kind: "excavator", operatorId: "OP1001", role: "excavate" },
  { id: "WHL001", kind: "loader", operatorId: "OP1007", role: "load" },
  { id: "DOZ001", kind: "bulldozer", operatorId: "OP1003", role: "push" },
  { id: "TRK001", kind: "truck", operatorId: "OP1004", role: "haul" },
  { id: "TRK002", kind: "truck", operatorId: "OP1006", role: "haul" },
  { id: "TRK003", kind: "truck", operatorId: "OP1005", role: "haul" },
  { id: "TRK004", kind: "truck", operatorId: "OP1008", role: "haul" },
  { id: "GRD001", kind: "grader", operatorId: "OP1009", role: "grade" },
];

export const MACHINES: MachineDescriptor[] = FLEET.map((m) => {
  const record = getMachine(m.id);
  return {
    id: m.id,
    // "320" -> "CAT 320"; fall back if the dataset ever drops a machine.
    model: record ? `CAT ${record.model}` : m.id,
    kind: m.kind,
    controllable: m.id === "EXC001",
    operatorId: m.operatorId,
    engineHours: record?.engineHoursStart ?? 0,
  };
});

const WORKER_IDS = Object.keys(WORKER_ROUTES);
/** The spotter that periodically walks in on EXC001 for the proximity demo. */
const SPOTTER_ID = "WRK003";

const WORKER_SPEED = 1.25;

interface RouteState {
  index: number;
  dwellLeft: number;
}

interface WorkerRuntime {
  worker: SiteWorker;
  route: Waypoint[];
  state: RouteState;
  /** Seconds until this worker next wanders toward the excavator. */
  approachCooldown: number;
  /** Seconds left of an active approach. */
  approachLeft: number;
  /** Seconds a test-bench placement holds this worker still. */
  pinnedLeft?: number;
}

export interface UiSnapshot {
  tick: number;
  primary: MachineTelemetry;
  machines: MachineTelemetry[];
  workers: SiteWorker[];
  proximity: ProximityResult;
  risks: CollisionRisk[];
  alerts: Alert[];
  events: SimEvent[];
  tasks: SiteTask[];
  activeTask: SiteTask | null;
  siteSafety: ProximityLevel;
  weather: WeatherMode;
  paused: boolean;
  source: TelemetrySource;
  emergencyStopped: boolean;
  engineWarning: boolean;
  /** Live-link state; only meaningful when source is "websocket". */
  linkStatus: LinkStatus;
  linkDetail: string;
  /** Machines the live feed is currently driving. */
  liveMachines: number;
  fps: number;
  clock: string;
  /** Active incident replay, if any. */
  replay: {
    incidentId: string;
    type: string;
    severity: string;
    machineId: string;
    shownOn: string;
    progress: number;
    durationS: number;
  } | null;
  /** The physics scenario running (or the one that last ran), if any. */
  scenario: (ScenarioStatus & { focus: string | null }) | null;
  /** Rigid-body world status; null until the physics WASM has loaded. */
  physics: (PhysicsStats & {
    /** Stepping this frame (false in live / replay mode). */
    active: boolean;
    materialTonnes: number;
    faceFailed: boolean;
    /** Machine pairs in contact right now. */
    contacts: string[];
  }) | null;
}

const TASK_TEMPLATE: Omit<SiteTask, "progress" | "status">[] = [
  { id: "t1", name: "ZONE B EXCAVATION", zone: "zone-b", advancedBy: "digging" },
  { id: "t2", name: "TRAVEL TO STOCKPILE", zone: "stockpile", advancedBy: "traveling" },
  { id: "t3", name: "STOCKPILE LOADING", zone: "stockpile", advancedBy: "loading" },
  { id: "t4", name: "RETURN TO ZONE B", zone: "zone-b", advancedBy: "traveling" },
];

export class SimulationEngine {
  private telemetry = new Map<string, MachineTelemetry>();
  private models = new Map<string, VehicleModel>();
  /** Behaviour state for every machine the twin drives itself. */
  private agents: Agent[] = [];
  private workers: WorkerRuntime[] = [];

  private tasks: SiteTask[] = [];
  private activeTaskIndex = 0;

  private alerts = new Map<string, Alert>();
  private events: SimEvent[] = [];

  private proximity: ProximityResult = {
    level: "safe",
    nearest: Infinity,
    nearestWorkerId: null,
    readings: [],
  };
  private risks: CollisionRisk[] = [];
  private paths = new Map<string, PredictedPath>();

  weather: WeatherMode = "clear";
  paused = false;
  source: TelemetrySource = "keyboard";
  emergencyStopped = false;

  /** Director-panel injected faults. */
  private hydraulicSpike = 0;
  private engineWarningLeft = 0;
  private tipOverBias = { pitch: 0, roll: 0 };
  private tipOverLeft = 0;
  private forcedCollisionLeft = 0;

  /**
   * Active incident replay. While set, the recorded track drives machine and
   * worker positions instead of the live physics — the proximity engine then
   * evaluates real recorded geometry, not a simulation of it.
   */
  private replay: { track: IncidentTrack; time: number; machineId: string } | null = null;

  /**
   * External frame driver (scenario playback). While set it replaces the
   * primary machine's physics and the spotter's walking; the rest of the
   * fleet and the whole safety layer keep running, so detections are real.
   */
  private driver: ((dt: number) => void) | null = null;
  /** Shown instead of wall-clock time while a scenario sets its own time of day. */
  private clockOverride: string | null = null;

  /** 0 -> 1 as rain soaks the ground; drives the wet-terrain look. */
  wetness = 0;
  /** 0 -> 1 fog density ramp. */
  fogAmount = 0;

  private tick = 0;
  private elapsed = 0;
  private fps = 60;
  private accumulatedSince = 0;
  private framesSince = 0;

  /** Debounce state so the event feed does not repeat itself. */
  private flags = {
    moving: false,
    zoneId: "" as string,
    proximity: "safe" as ProximityLevel,
    tipOver: "safe" as string,
    lowFuel: false,
    hotOil: false,
    collision: false,
  };

  /** Live link, when the source is the simulator on the wire. */
  private liveProvider: WebSocketTelemetryProvider | null = null;
  private unsubscribeLive: (() => void) | null = null;
  /** Latest frame per machine, interpolated toward at render rate. */
  private liveTargets = new Map<string, MachineTelemetry>();
  /** Machines that have had at least one live frame applied. */
  private liveSeen = new Set<string>();
  private liveWorkerTargets = new Map<string, SiteWorker>();
  linkStatus: LinkStatus = "idle";
  linkDetail = "";

  private mockProvider: MockTelemetryProvider | null = null;
  private mockModel: VehicleModel | null = null;
  private unsubscribeMock: (() => void) | null = null;
  private pendingFrame: MachineTelemetry | null = null;

  /** The rigid-body world, once loaded. */
  physics: PhysicsWorld | null = null;
  private physicsLoading: Promise<PhysicsWorld | null> | null = null;
  /** Whether the world was stepped on the last frame. */
  private physicsActive = false;
  /**
   * Set by a view that wants the kinematic model only (the guided lesson).
   * The world stays loaded; bodies go kinematic and resume where telemetry
   * left them once the flag clears.
   */
  private physicsSuspended = false;
  /** Alerts raised by physical events, and the elapsed time they expire at. */
  private timedAlerts = new Map<string, number>();
  /** Per-machine AI state for physical traffic: seconds boxed in. */
  private blockedFor = new Map<string, number>();
  /** Seconds each machine has been pushing without moving. */
  private stalledFor = new Map<string, number>();
  /** Machines backing off an obstacle. */
  private recovering = new Map<string, { left: number; steer: number }>();
  /** Machines giving way to another: seconds of the manoeuvre left. */
  private yielding = new Map<string, { left: number }>();
  /**
   * Per-machine scripted input from the scenario runner. While set, it
   * replaces the machine's route AI (or the keyboard, for the primary).
   */
  readonly overrides = new Map<string, VehicleInput>();
  /** Machines whose V2V braking a scenario has switched off. */
  readonly avoidanceOff = new Set<string>();
  /** Data-driven physics scenarios (physics/scenarios/library.ts). */
  readonly scenarios = new ScenarioRunner();

  constructor() {
    this.build();
    // The browser loads the physics world in the background; headless callers
    // (tests, scripts) opt in with `await engine.enablePhysics()`.
    if (typeof window !== "undefined") void this.enablePhysics();
  }

  /**
   * Loads Rapier and moves the local fleet onto rigid bodies. Safe to call
   * more than once; resolves to null if WASM is unavailable, in which case
   * the kinematic model simply keeps running.
   */
  enablePhysics(): Promise<PhysicsWorld | null> {
    if (this.physics) return Promise.resolve(this.physics);
    if (!this.physicsLoading) {
      this.physicsLoading = PhysicsWorld.create()
        .then((world) => {
          this.physics = world;
          this.attachFleet();
          this.pushEvent("Physics engine online — rigid bodies, contact and traction", "info");
          return world;
        })
        .catch((err: unknown) => {
          this.pushEvent(`Physics unavailable (${String(err)}) — kinematic model in use`, "warning");
          return null;
        });
    }
    return this.physicsLoading;
  }

  /** Pauses (or resumes) the rigid-body world without unloading it. */
  setPhysicsSuspended(on: boolean): void {
    this.physicsSuspended = on;
  }

  /** Gives every simulated machine a rigid body and lays out the site's loose spoil. */
  private attachFleet(): void {
    const world = this.physics;
    if (!world) return;
    for (const d of MACHINES) {
      const body = world.addMachine(d.id, d.kind, this.telemetryOf(d.id));
      this.modelOf(d.id).attachPhysics(body);
    }
    // Spoil on the pit floor, where the dozer works it.
    world.material.scatter(-6, -63, 7, 18);
  }

  /* --------------------------------------------------------------------- */
  /*  Construction                                                          */
  /* --------------------------------------------------------------------- */

  private build(): void {
    // Primary machine.
    // Start the machine where its own recorded history says it usually sits:
    // the mean hydraulic temperature from 30 days of telemetry.
    const excRollup = getRollup(PRIMARY_MACHINE);
    const exc = createTelemetry(PRIMARY_MACHINE, {
      x: EXCAVATOR_HOME.x,
      z: EXCAVATOR_HOME.z,
      heading: EXCAVATOR_HOME.heading,
      fuel: 67,
      hydraulicTemperature: excRollup?.avgHydraulicC ?? 64,
    });
    this.register(exc, TUNING.excavator);

    // Autonomous fleet, each placed mid-cycle so the site is busy from frame one.
    const ordinals = new Map<string, number>();
    this.agents = [];
    for (const m of FLEET) {
      if (m.role === "hero") continue;
      const n = ordinals.get(m.role) ?? 0;
      ordinals.set(m.role, n + 1);
      const place = initialPlacement(m.role, n);
      const rollup = getRollup(m.id);
      const t = createTelemetry(m.id, {
        x: place.x,
        z: place.z,
        heading: place.heading,
        fuel: 40 + Math.random() * 45,
        hydraulicTemperature: rollup?.avgHydraulicC ?? 70,
        payload: place.payload,
        boomAngle: m.kind === "excavator" ? 22 * DEG : 0.1,
        stickAngle: m.kind === "excavator" ? -10 * DEG : 0,
        bucketAngle: 0,
      });
      const model = this.register(t, TUNING[m.kind]);
      this.agents.push({
        id: m.id,
        role: m.role,
        t,
        model,
        phase: place.phase,
        timer: 0,
        index: place.index,
        lane: 0,
        target: null,
      });
    }

    // Site crew.
    this.workers = WORKER_IDS.map((id, i) => {
      const route = WORKER_ROUTES[id];
      return {
        worker: {
          id,
          x: route[0].x,
          z: route[0].z,
          state: "walking",
          heading: 0,
          phase: (i * Math.PI) / 3,
        },
        route,
        state: { index: 1, dwellLeft: 0 },
        approachCooldown: id === SPOTTER_ID ? 22 : 9999,
        approachLeft: 0,
      };
    });

    this.tasks = TASK_TEMPLATE.map((t, i) => ({
      ...t,
      progress: i === 0 ? 38 : 0,
      status: i === 0 ? "active" : "pending",
    }));

    this.pushEvent("Digital twin session started", "info");
    this.pushEvent(
      `Fleet records loaded — ${dataset.meta.telemetryRows.toLocaleString()} telemetry samples`,
      "info",
    );
    this.pushEvent(`${PRIMARY_MACHINE} telemetry link established`, "info");

    // Anything the maintenance records already flag is worth saying up front.
    for (const m of MACHINES) {
      const health = getHealth(m.id);
      if (health && health.hydraulicHealth < 60) {
        this.pushEvent(
          `${m.id} hydraulic health ${health.hydraulicHealth.toFixed(0)}% — service due`,
          "warning",
        );
      }
    }
  }

  private register(t: MachineTelemetry, tuning: (typeof TUNING)[string]): VehicleModel {
    this.telemetry.set(t.machineId, t);
    const model = new VehicleModel(t, tuning);
    // Settle the machine onto the terrain before the first frame is drawn,
    // keeping the load and implement pose it was placed with.
    const keep = {
      payload: t.payload,
      boomAngle: t.boomAngle,
      stickAngle: t.stickAngle,
      bucketAngle: t.bucketAngle,
    };
    model.reset(t.x, t.z, t.heading);
    Object.assign(t, keep);
    this.models.set(t.machineId, model);
    return model;
  }

  /* --------------------------------------------------------------------- */
  /*  Read access for the renderer                                          */
  /* --------------------------------------------------------------------- */

  /** Stable, mutated-in-place telemetry. Safe to hold across frames. */
  telemetryOf(id: string): MachineTelemetry {
    const t = this.telemetry.get(id);
    if (!t) throw new Error(`Unknown machine: ${id}`);
    return t;
  }

  /**
   * Like telemetryOf, but never throws. Fleet IDs outside the twin's
   * simulated set (e.g. EXC003 from the fleet fixtures) fall back to the
   * primary machine so a stale or cross-view selection can't crash a frame.
   */
  telemetryOrPrimary(id: string): MachineTelemetry {
    return this.telemetry.get(id) ?? this.primary;
  }

  get primary(): MachineTelemetry {
    return this.telemetryOf(PRIMARY_MACHINE);
  }

  allTelemetry(): MachineTelemetry[] {
    return MACHINES.map((m) => this.telemetryOf(m.id));
  }

  /** Live worker objects — also mutated in place. */
  liveWorkers(): SiteWorker[] {
    return this.workers.map((w) => w.worker);
  }

  modelOf(id: string): VehicleModel {
    const m = this.models.get(id);
    if (!m) throw new Error(`Unknown machine: ${id}`);
    return m;
  }

  livePaths(): PredictedPath[] {
    return Array.from(this.paths.values());
  }

  liveRisks(): CollisionRisk[] {
    return this.risks;
  }

  liveProximity(): ProximityResult {
    return this.proximity;
  }

  /* --------------------------------------------------------------------- */
  /*  The frame tick                                                        */
  /* --------------------------------------------------------------------- */

  step(dt: number, input: VehicleInput): void {
    // Clamp so an alt-tabbed tab does not teleport the fleet on return.
    const step = Math.min(dt, 0.05);

    this.framesSince++;
    this.accumulatedSince += dt;
    if (this.accumulatedSince >= 0.5) {
      this.fps = this.framesSince / this.accumulatedSince;
      this.framesSince = 0;
      this.accumulatedSince = 0;
    }

    if (this.paused) return;

    this.elapsed += step;
    this.tick++;

    this.stepEnvironment(step);

    // Physics runs for the locally simulated fleet only. Live telemetry and
    // recorded replays are the authority on pose; the world isn't touched.
    const local = !this.replay && this.source !== "websocket";
    this.syncPhysicsModes(local && !this.physicsSuspended);
    if (this.scenarios.running) {
      if (this.physicsActive) this.scenarios.tick(step, this);
      else this.scenarios.stop(this);
    }

    if (this.driver) {
      this.stepFleet(step);
      this.stepWorkers(step);
      this.driver(step);
      this.stepPhysics(step);
      this.stepSafety();
      this.stepTasks(step);
      return;
    }

    if (this.replay) {
      this.stepReplay(step);
      this.stepSafety();
      this.stepTasks(step);
      return;
    }

    if (this.source === "websocket") {
      this.stepLive(step);
      this.stepSafety();
      this.stepTasks(step);
      return;
    }

    this.stepPrimary(step, input);
    this.stepFleet(step);
    this.stepWorkers(step);
    this.stepPhysics(step);
    this.stepSafety();
    this.stepTasks(step);
  }

  /* --------------------------------------------------------------------- */
  /*  Physics                                                               */
  /* --------------------------------------------------------------------- */

  /**
   * Decides, per machine, whether the rigid body is simulated (dynamic) or
   * follows telemetry from elsewhere (kinematic). The primary machine follows
   * telemetry while a scenario frame driver or the mock IoT feed owns it.
   * Everything is kinematic while physics is paused for live/replay mode, so
   * the bodies pick up exactly where telemetry left them on return.
   */
  private syncPhysicsModes(local: boolean): void {
    const world = this.physics;
    if (!world) return;
    for (const d of MACHINES) {
      const body = world.machine(d.id);
      if (!body) continue;
      const external =
        !local || (d.id === PRIMARY_MACHINE && (this.driver !== null || this.source === "mock_iot"));
      body.setKinematic(external);
    }
    this.physicsActive = local;
  }

  private stepPhysics(dt: number): void {
    const world = this.physics;
    if (!world || !this.physicsActive) return;
    world.wetness = this.wetness;
    world.step(dt);
    // Stability is a display metric fed by the physical attitude.
    for (const d of MACHINES) {
      if (this.modelOf(d.id).physical) {
        const t = this.telemetryOf(d.id);
        t.tipOverMargin = computeTipOverMargin(t);
      }
    }
    this.pourMaterial();
    this.reactToPhysics();
  }

  /** Material the excavator bucket lets go of lands as real parcels. */
  private pourMaterial(): void {
    const world = this.physics;
    if (!world) return;
    const model = this.modelOf(PRIMARY_MACHINE);
    const body = world.machine(PRIMARY_MACHINE);
    if (body && model.dumped >= 900) {
      world.material.pour(body.toWorld(body.loadPoint), model.dumped, { x: 0, y: -0.5, z: 0 }, 0.4);
      model.dumped = 0;
    }
  }

  /** Turns physical events — contact, tip-over, face failure, slip — into alerts. */
  private reactToPhysics(): void {
    const world = this.physics;
    if (!world) return;

    for (const c of world.takeNewContacts()) {
      const involvesPrimary = c.a === PRIMARY_MACHINE || c.b === PRIMARY_MACHINE;
      this.raiseTimed(
        {
          id: `impact:${c.a}|${c.b}`,
          kind: "collision",
          severity: "critical",
          title: "MACHINE CONTACT",
          message: `${c.a} ↔ ${c.b}`,
          machineId: involvesPrimary ? PRIMARY_MACHINE : c.a,
          detail: {
            Contact: `${c.partA.replace(/_/g, " ")} / ${c.partB.replace(/_/g, " ")}`,
            Force: c.force > 0 ? `${Math.round(c.force / 1000)} kN` : "—",
          },
          recommendation: "STOP BOTH MACHINES — INSPECT FOR DAMAGE",
        },
        10,
      );
      this.pushEvent(`Contact: ${c.a} and ${c.b} (${c.partA} / ${c.partB})`, "critical");
    }

    for (const body of world.machines.values()) {
      const id = body.id;
      if (body.tippedOver && !this.alerts.has(`tipped:${id}`)) {
        this.raiseTimed(
          {
            id: `tipped:${id}`,
            kind: "tip_over",
            severity: "critical",
            title: "MACHINE OVERTURNED",
            message: `${id} HAS TIPPED`,
            machineId: id,
            detail: { Tilt: `${Math.round(body.tilt / DEG)}°`, Payload: `${Math.round(body.telemetry.payload)} kg` },
            recommendation: "ISOLATE AREA — CHECK OPERATOR — RECOVERY CREW",
          },
          3600,
        );
        this.pushEvent(`${id} overturned (${Math.round(body.tilt / DEG)}° tilt)`, "critical");
      }
      if (body.slip > 0.45 && Math.abs(body.speed) > 0.3 && !body.kinematic) {
        this.raiseTimed(
          {
            id: `slip:${id}`,
            kind: "weather",
            severity: "warning",
            title: "TRACTION LOSS",
            message: `${id} SLIPPING`,
            machineId: id,
            detail: {
              Grip: `μ ${body.groundFriction.toFixed(2)}`,
              Speed: `${body.speed.toFixed(1)} m/s`,
              Grade: `${(Math.abs(body.telemetry.pitch) / DEG).toFixed(1)}°`,
            },
            recommendation: "STOP — DO NOT CLIMB WET RAMP LOADED",
          },
          6,
        );
      }
    }

    const face = world.face;
    if (face.failedBy) {
      this.raiseTimed(
        {
          id: "slope:face-c",
          kind: "tip_over",
          severity: "critical",
          title: "SLOPE FAILURE",
          message: "BENCH FACE C HAS FAILED",
          machineId: face.failedBy === "scenario" ? PRIMARY_MACHINE : face.failedBy,
          detail: { Trigger: face.failedBy, Face: "C — 5.5 m, over-steep" },
          recommendation: "EVACUATE FACE C — NO ENTRY BELOW CREST",
        },
        30,
      );
      this.pushEvent(`Bench face C failed under ${face.failedBy}`, "critical");
      face.failedBy = null;
    }
  }

  /** Raises an alert that clears itself after `seconds` of simulation time. */
  private raiseTimed(alert: Omit<Alert, "createdAt">, seconds: number): void {
    this.setAlert(alert);
    this.timedAlerts.set(alert.id, this.elapsed + seconds);
  }

  private stepContext(): StepContext {
    const heat = this.weather === "heat" ? 16 : this.weather === "rain" ? -6 : 0;
    return {
      emergencyStopped: this.emergencyStopped,
      hydraulicAmbientBias: heat,
      hydraulicSpike: this.hydraulicSpike,
      grip: this.weather === "rain" ? 0.82 : 1,
      attitudeBias: this.tipOverBias,
    };
  }

  private stepEnvironment(dt: number): void {
    for (const [id, until] of this.timedAlerts) {
      if (this.elapsed >= until) {
        this.timedAlerts.delete(id);
        this.clearAlert(id);
      }
    }

    // Injected faults decay back to normal on their own.
    this.hydraulicSpike = damp(this.hydraulicSpike, 0, 0.06, dt);
    if (this.engineWarningLeft > 0) this.engineWarningLeft -= dt;

    if (this.tipOverLeft > 0) {
      this.tipOverLeft -= dt;
      if (this.tipOverLeft <= 0) this.tipOverBias = { pitch: 0, roll: 0 };
    }
    if (this.forcedCollisionLeft > 0) this.forcedCollisionLeft -= dt;

    const targetWet = this.weather === "rain" ? 1 : 0;
    this.wetness = damp(this.wetness, targetWet, 0.45, dt);
    const targetFog = this.weather === "fog" ? 1 : this.weather === "rain" ? 0.35 : 0;
    this.fogAmount = damp(this.fogAmount, targetFog, 0.7, dt);
  }

  private stepPrimary(dt: number, input: VehicleInput): void {
    const model = this.modelOf(PRIMARY_MACHINE);

    if (this.source === "mock_iot") {
      // The provider is the authority; copy its frame onto the live object so
      // every consumer downstream is none the wiser.
      if (this.pendingFrame) {
        Object.assign(this.telemetryOf(PRIMARY_MACHINE), this.pendingFrame);
        this.pendingFrame = null;
      }
      // Keep the track animation running off the reported speed.
      model.trackTravel += this.primary.speed * dt;
      return;
    }

    model.step(this.overrides.get(PRIMARY_MACHINE) ?? input, dt, this.stepContext());
  }

  private stepFleet(dt: number): void {
    const ctx = this.stepContext();
    const free = { ...ctx, emergencyStopped: false };
    // V2V braking through the physics world applies to every autonomous
    // move; without physics `withAvoidance` passes input straight through.
    const world: FleetWorld = {
      agents: this.agents,
      ctx,
      filter: (agent, input, step) => this.withAvoidance(agent.id, input, step),
    };

    for (const agent of this.agents) {
      // A scenario is driving this machine.
      const scripted = this.overrides.get(agent.id);
      if (scripted) {
        agent.model.step(this.withAvoidance(agent.id, scripted, dt), dt, free);
        continue;
      }

      // Director override: aim the dozer straight at the excavator. With
      // physics on, this ends in real contact — V2V braking is off for it.
      if (this.forcedCollisionLeft > 0 && agent.id === "DOZ001") {
        const p = this.primary;
        const arrive = this.physicsActive ? 0.5 : 3;
        agent.model.step(steerToward(agent.t, p.x, p.z, { cruise: 1, arriveRadius: arrive }), dt, free);
        continue;
      }

      const before = agent.t.payload;
      stepAgent(agent, world, dt);
      if (agent.role === "haul") this.onTipped(agent, before);
    }
  }

  /**
   * V2V braking through the physics world: a shape cast of the machine's own
   * footprint along its path. The machine slows for whatever it would hit
   * and stops short — or, if a scenario has switched this off, doesn't.
   * Boxed in for long enough, it backs off to let the other machine clear.
   */
  private withAvoidance(id: string, input: VehicleInput, dt: number): VehicleInput {
    const world = this.physics;
    const yielding = this.yielding.get(id);
    if (yielding) {
      // Giving way: back off, then hold while the other machine clears.
      yielding.left -= dt;
      if (yielding.left <= 0) this.yielding.delete(id);
      return { ...input, throttle: yielding.left > 3.5 ? -0.45 : 0, steer: 0 };
    }
    if (!world || !this.physicsActive || this.avoidanceOff.has(id) || Math.abs(input.throttle) < 0.02) {
      this.blockedFor.set(id, 0);
      return input;
    }
    const body = world.machine(id);
    if (!body) return input;

    // Stalled against something that isn't a machine — a windrow end, a heap,
    // a structure: back off on opposite lock and have another go.
    const recovering = this.recovering.get(id);
    if (recovering) {
      recovering.left -= dt;
      if (recovering.left <= 0) this.recovering.delete(id);
      return { ...input, throttle: -Math.sign(input.throttle) * 0.5, steer: recovering.steer };
    }
    const stalled = Math.abs(body.speed) < 0.12 && Math.abs(input.throttle) > 0.2 ? (this.stalledFor.get(id) ?? 0) + dt : 0;
    this.stalledFor.set(id, stalled);
    if (stalled > 3) {
      this.stalledFor.set(id, 0);
      this.recovering.set(id, { left: 2.5, steer: -Math.sign(input.steer || 1) });
    }
    const v = Math.abs(body.speed);
    const lookAhead = Math.max(6, (v * v) / 2 + 5);
    const { distance: clear, other } = world.clearance(id, lookAhead);
    if (clear >= lookAhead) {
      this.blockedFor.set(id, 0);
      return input;
    }
    const factor = clamp((clear - 1.5) / (lookAhead - 1.5), 0, 1);
    const blocked = (this.blockedFor.get(id) ?? 0) + (factor < 0.05 ? dt : 0);
    this.blockedFor.set(id, blocked);
    // Right of way: haul truck, then loader, then dozer; the operator's
    // machine always has it. After a few seconds nose to nose, the machine
    // with less right of way backs off; the other waits for the gap.
    if (blocked > 3 && other && rightOfWay(id) < rightOfWay(other)) {
      this.yielding.set(id, { left: 7 });
      this.blockedFor.set(id, 0);
    }
    return { ...input, throttle: input.throttle * factor };
  }

  /**
   * A haul truck that has just tipped. With physics on, the load lands as
   * real material behind the body rather than vanishing.
   */
  private onTipped(agent: Agent, before: number): void {
    const dropped = before - agent.t.payload;
    if (dropped < 1000 || !this.physicsActive) return;
    const body = this.physics?.machine(agent.id);
    if (!body) return;
    const back = body.toWorld({ x: 0, y: 0, z: 1 });
    const origin = body.toWorld({ x: 0, y: 0, z: 0 });
    this.physics?.material.pour(body.toWorld({ x: 0, y: 2.6, z: 5.3 }), dropped, {
      x: (back.x - origin.x) * 1.5,
      y: -0.5,
      z: (back.z - origin.z) * 1.5,
    });
  }

  private stepWorkers(dt: number): void {
    const p = this.primary;

    for (const runtime of this.workers) {
      const w = runtime.worker;
      runtime.worker.phase += dt * (w.state === "walking" ? 6 : 2);

      // Test-bench placement: stand still where the bench put them.
      if (runtime.pinnedLeft && runtime.pinnedLeft > 0) {
        runtime.pinnedLeft -= dt;
        w.state = "working";
        continue;
      }

      // Periodic approach: this is what makes the proximity demo reliable.
      if (runtime.approachLeft > 0) {
        runtime.approachLeft -= dt;
        this.walkToward(runtime, p.x, p.z, dt, 5);
        w.state = "walking";
        continue;
      }

      runtime.approachCooldown -= dt;
      if (runtime.approachCooldown <= 0) {
        runtime.approachLeft = 16;
        runtime.approachCooldown = 55 + Math.random() * 25;
        this.pushEvent(`${w.id} moving toward ${PRIMARY_MACHINE}`, "info");
        continue;
      }

      if (runtime.state.dwellLeft > 0) {
        runtime.state.dwellLeft -= dt;
        w.state = runtime.state.dwellLeft > 1.5 ? "working" : "idle";
        continue;
      }

      const target = runtime.route[runtime.state.index % runtime.route.length];
      const arrived = this.walkToward(runtime, target.x, target.z, dt, 1.2);
      w.state = "walking";
      if (arrived) {
        runtime.state.dwellLeft = target.dwell ?? 2;
        runtime.state.index = (runtime.state.index + 1) % runtime.route.length;
      }
    }
  }

  /** Moves a worker toward a point. Returns true on arrival. */
  private walkToward(
    runtime: WorkerRuntime,
    tx: number,
    tz: number,
    dt: number,
    stopAt: number,
  ): boolean {
    const w = runtime.worker;
    const dx = tx - w.x;
    const dz = tz - w.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= stopAt) return true;

    const stepLen = Math.min(WORKER_SPEED * dt, dist - stopAt);
    w.x += (dx / dist) * stepLen;
    w.z += (dz / dist) * stepLen;
    w.heading = Math.atan2(dx, -dz);
    return false;
  }

  /**
   * Advances the recorded track and writes it straight onto telemetry.
   *
   * Frames are one second apart, so positions are interpolated to keep motion
   * smooth at 60fps. Heading is interpolated on the shortest arc so a machine
   * crossing north does not spin the long way round.
   */
  private stepReplay(dt: number): void {
    const replay = this.replay;
    if (!replay) return;

    const { track } = replay;
    replay.time += dt;
    // Loop with a short pause so the moment of the incident can be re-watched.
    const total = track.durationS + 2;
    if (replay.time > total) replay.time = 0;

    const clamped = Math.min(replay.time, track.durationS);
    const index = Math.min(Math.floor(clamped), track.frames.length - 1);
    const next = Math.min(index + 1, track.frames.length - 1);
    const alpha = clamped - index;

    const a = track.frames[index];
    const b = track.frames[next];

    const machine = a.machines[0];
    const machineB = b.machines[0] ?? machine;
    if (machine) {
      const t = this.telemetryOf(replay.machineId);
      const prevX = t.x;
      const prevZ = t.z;

      t.x = lerp(machine.x, machineB.x, alpha);
      t.z = lerp(machine.z, machineB.z, alpha);
      t.heading = normalizeHeading(
        machine.heading + angleDelta(machine.heading, machineB.heading) * alpha,
      );

      const att = sampleAttitude(t.x, t.z, t.heading);
      t.y = att.y;
      t.pitch = att.pitch;
      t.roll = att.roll;

      // Derive speed from the track rather than trusting a recorded field.
      t.speed = dt > 0 ? Math.hypot(t.x - prevX, t.z - prevZ) / dt : 0;
      t.engineRpm = damp(t.engineRpm, 800 + Math.min(t.speed / 3, 1) * 900, 3, dt);
      t.activity = t.speed > 0.5 ? "traveling" : "idle";
      t.tipOverMargin = computeTipOverMargin(t);

      this.modelOf(replay.machineId).trackTravel += t.speed * dt;
    }

    // Recorded workers take over the first crew slots; the rest stand down
    // well clear so they cannot pollute the proximity reading.
    const recorded = a.workers;
    this.workers.forEach((runtime, i) => {
      const w = recorded[i];
      const wb = b.workers[i];
      if (w) {
        runtime.worker.x = lerp(w.x, (wb ?? w).x, alpha);
        runtime.worker.z = lerp(w.z, (wb ?? w).z, alpha);
        runtime.worker.state = "walking";
        runtime.worker.phase += dt * 6;
      } else {
        runtime.worker.x = SITE_HALF - 4;
        runtime.worker.z = SITE_HALF - 4 - i * 3;
        runtime.worker.state = "idle";
      }
    });
  }

  /**
   * Eases every machine toward its latest live frame.
   *
   * The simulator publishes at 1 Hz. Snapping to each frame would make the
   * fleet teleport once a second, so positions and joint angles are damped
   * toward the target and headings take the shortest arc. Values that are
   * already readings rather than poses — fuel, temperature, payload — are
   * copied straight across.
   */
  private stepLive(dt: number): void {
    // Position/heading converge fast enough to stay in step with 1 Hz frames
    // without visible lag; implements move a little more gently.
    const POSE = 7;
    const JOINT = 5;

    for (const descriptor of MACHINES) {
      const target = this.liveTargets.get(descriptor.id);
      if (!target) continue;

      const t = this.telemetryOf(descriptor.id);

      // First frame for this machine: snap. Easing across the gap between where
      // the twin had it and where the live site says it is would otherwise look
      // like a machine sprinting across the site.
      if (!this.liveSeen.has(descriptor.id)) {
        this.liveSeen.add(descriptor.id);
        t.x = target.x;
        t.z = target.z;
        t.heading = target.heading;
        t.swingAngle = target.swingAngle;
      }

      t.x = damp(t.x, target.x, POSE, dt);
      t.z = damp(t.z, target.z, POSE, dt);
      t.heading = normalizeHeading(
        t.heading + angleDelta(t.heading, target.heading) * (1 - Math.exp(-POSE * dt)),
      );

      t.boomAngle = damp(t.boomAngle, target.boomAngle, JOINT, dt);
      t.stickAngle = damp(t.stickAngle, target.stickAngle, JOINT, dt);
      t.bucketAngle = damp(t.bucketAngle, target.bucketAngle, JOINT, dt);
      t.swingAngle = t.swingAngle + angleDelta(t.swingAngle, target.swingAngle) * (1 - Math.exp(-JOINT * dt));

      t.engineRpm = damp(t.engineRpm, target.engineRpm, 3, dt);
      t.hydraulicTemperature = damp(t.hydraulicTemperature, target.hydraulicTemperature, 2, dt);
      t.payload = damp(t.payload, target.payload, 4, dt);

      // Straight readings.
      t.fuel = target.fuel;
      t.tipOverMargin = target.tipOverMargin;
      t.activity = target.activity;

      // The feed only carries arm joints for excavators. Everything else gets
      // its implements posed from what it is reported to be doing, so a loader
      // at the bay visibly lifts and tips, and a truck on the dump tips its body.
      if (descriptor.kind !== "excavator") poseImplements(descriptor.kind, t, dt);

      // Ride the twin's own terrain rather than trusting a remote height.
      const tune = this.modelOf(descriptor.id).tuning;
      const att = sampleAttitude(t.x, t.z, t.heading, tune.wheelbase, tune.trackWidth);
      t.y = att.y;
      t.pitch = att.pitch;
      t.roll = att.roll;

      // Speed is a reading, not something to infer. Deriving it from frame-to
      // -frame motion turned interpolation catch-up into 100 km/h haul trucks.
      t.speed = target.speed;
      this.modelOf(descriptor.id).trackTravel += t.speed * dt;
    }

    // Workers: same easing, so the crew walks rather than blinking.
    this.workers.forEach((runtime, i) => {
      const targets = Array.from(this.liveWorkerTargets.values());
      const target = targets[i];
      const w = runtime.worker;
      if (!target) {
        w.state = "idle";
        return;
      }
      w.x = damp(w.x, target.x, 6, dt);
      w.z = damp(w.z, target.z, 6, dt);
      w.heading = target.heading;
      w.state = target.state;
      w.phase += dt * (target.state === "walking" ? 6 : 2);
    });
  }

  /** The machine slot a track is rendered through. */
  private replayMachineFor(track: IncidentTrack): string {
    return MACHINES.some((m) => m.id === track.machineId)
      ? track.machineId
      : PRIMARY_MACHINE;
  }

  startReplay(incidentId: string): void {
    const track = replays.tracks.find((t) => t.incidentId === incidentId);
    if (!track) return;

    this.emergencyStopped = false;
    const machineId = this.replayMachineFor(track);
    this.replay = { track, time: 0, machineId };
    this.selectedForReplay = machineId;

    const note =
      machineId === track.machineId
        ? ""
        : ` (shown on ${machineId} — ${track.machineId} is not in this view)`;
    this.pushEvent(
      `Replaying ${track.incidentId} · ${track.type} · ${track.severity}${note}`,
      track.severity === "critical" ? "critical" : "warning",
    );
  }

  stopReplay(): void {
    if (!this.replay) return;
    const id = this.replay.track.incidentId;
    this.replay = null;
    this.selectedForReplay = null;
    this.pushEvent(`Replay ${id} ended — live simulation resumed`, "info");
  }

  get replayTrack(): IncidentTrack | null {
    return this.replay?.track ?? null;
  }

  get replayProgress(): number {
    if (!this.replay) return 0;
    return Math.min(1, this.replay.time / this.replay.track.durationS);
  }

  /** Machine the active replay is driving, for the HUD to select. */
  selectedForReplay: string | null = null;

  /** Whichever machine the safety engine should treat as the subject. */
  get focusMachineId(): string {
    return this.replay?.machineId ?? PRIMARY_MACHINE;
  }

  private stepSafety(): void {
    const workers = this.liveWorkers();
    const world = this.physicsActive ? this.physics : null;

    // Per-machine worker distances. With physics running they are measured to
    // the machine's hull through the world's broadphase and narrowphase;
    // otherwise (live, replay) to its centre on the ground plane.
    const distances = new Map<string, { workerId: string; distance: number }[]>();
    for (const m of MACHINES) {
      const t = this.telemetryOf(m.id);
      const hull = world?.proximity(m.id, workers, 40);
      const list = workers.map((w, i) => {
        const d = hull?.[i]?.distance;
        return { workerId: w.id, distance: d !== undefined && Number.isFinite(d) ? d : Math.hypot(w.x - t.x, w.z - t.z) };
      });
      distances.set(m.id, list);
      t.nearestPerson = list.reduce((n, r) => Math.min(n, r.distance), Infinity);
    }

    // The site-level reading tracks the machine in focus: normally EXC001, but
    // the replayed machine while a recorded incident is playing.
    const subject = this.telemetryOf(this.focusMachineId);
    const subjectDistances = distances.get(this.focusMachineId);
    this.proximity = subjectDistances ? proximityFromDistances(subjectDistances) : evaluateProximity(subject, workers);
    subject.nearestPerson = this.proximity.nearest;

    // Predicted paths and pairwise conflicts.
    const all = this.allTelemetry();
    this.paths.clear();
    for (const t of all) this.paths.set(t.machineId, predictPath(t));
    // Machines meeting at a service point are working together, not colliding —
    // a loader dumping into a truck, trucks queued for the bay. Same rule as the
    // backend's V2V layer (simulator/v2x.py SERVICE_POINTS).
    this.risks = detectCollisionRisks(all).filter((r) => {
      const a = this.telemetry.get(r.a);
      const b = this.telemetry.get(r.b);
      return !(a && b && atServicePoint(a.x, a.z) && atServicePoint(b.x, b.z));
    });

    this.reconcileAlerts();
    this.emitEvents();
  }

  private stepTasks(dt: number): void {
    const task = this.tasks[this.activeTaskIndex];
    if (!task) return;

    const p = this.primary;
    const zone = zoneAt(p.x, p.z);
    const inZone = zone?.id === task.zone;
    const matches = p.activity === task.advancedBy;

    if (matches && (inZone || task.advancedBy === "traveling")) {
      // Travelling tasks count progress for heading the right way; work tasks
      // only count inside the zone they belong to.
      task.progress = clamp(task.progress + 4.5 * dt, 0, 100);
    } else if (p.activity !== "idle" && p.activity !== "emergency_stop") {
      // Working on the wrong thing slowly loses ground.
      task.progress = clamp(task.progress - 0.45 * dt, 0, 100);
    }

    if (task.progress >= 100 && task.status !== "complete") {
      task.status = "complete";
      this.pushEvent(`Task complete: ${task.name}`, "info");
      this.activeTaskIndex = (this.activeTaskIndex + 1) % this.tasks.length;
      const next = this.tasks[this.activeTaskIndex];
      next.status = "active";
      next.progress = 0;
      this.pushEvent(`Task assigned: ${next.name}`, "info");
    }
  }

  /* --------------------------------------------------------------------- */
  /*  Alerts and events                                                     */
  /* --------------------------------------------------------------------- */

  private setAlert(alert: Omit<Alert, "createdAt"> & { createdAt?: number }): void {
    const existing = this.alerts.get(alert.id);
    this.alerts.set(alert.id, {
      ...alert,
      createdAt: existing?.createdAt ?? alert.createdAt ?? Date.now(),
    });
  }

  private clearAlert(id: string): void {
    this.alerts.delete(id);
  }

  /**
   * Raises an alert from outside the engine.
   *
   * Note that `reconcileAlerts` owns the ids it manages and will clear an
   * injected alert that reuses one of them on the next tick — pass a distinct
   * id for anything that should persist.
   */
  injectAlert(alert: Omit<Alert, "createdAt">): void {
    this.setAlert(alert);
    this.pushEvent(`${alert.title} — ${alert.message}`, alert.severity);
  }

  private reconcileAlerts(): void {
    const p = this.telemetryOf(this.focusMachineId);

    // --- Proximity -------------------------------------------------------
    const prox = this.proximity;
    if (prox.level !== "safe" && prox.nearestWorkerId) {
      const imminent = prox.nearest <= PROXIMITY.imminent;
      this.setAlert({
        id: "proximity:EXC001",
        kind: "proximity",
        severity: prox.level === "critical" ? "critical" : "warning",
        title: prox.level === "critical" ? "PROXIMITY HAZARD" : "PROXIMITY WARNING",
        message: "WORKER DETECTED",
        machineId: PRIMARY_MACHINE,
        detail: {
          Worker: prox.nearestWorkerId,
          Distance: `${prox.nearest.toFixed(1)} m`,
        },
        recommendation:
          prox.level === "critical"
            ? imminent
              ? "STOP MACHINE"
              : "STOP MACHINE — WORKER IN SWING RADIUS"
            : "REDUCE SPEED / SOUND HORN",
      });
    } else {
      this.clearAlert("proximity:EXC001");
    }

    // --- Collision -------------------------------------------------------
    const risk = this.risks.find((r) => r.a === PRIMARY_MACHINE || r.b === PRIMARY_MACHINE);
    if (risk) {
      const other = risk.a === PRIMARY_MACHINE ? risk.b : risk.a;
      this.setAlert({
        id: "collision:EXC001",
        kind: "collision",
        severity: risk.separation < 5 ? "critical" : "warning",
        title: "COLLISION RISK",
        message: `${PRIMARY_MACHINE} → ${other}`,
        machineId: PRIMARY_MACHINE,
        detail: {
          Separation: `${risk.separation.toFixed(1)} m`,
          "Time to closest": `${risk.timeToClosest.toFixed(1)} s`,
        },
        recommendation: "YIELD — CONFIRM RIGHT OF WAY",
      });
    } else {
      this.clearAlert("collision:EXC001");
    }

    // --- Stability -------------------------------------------------------
    const tip = tipOverLevel(p.tipOverMargin);
    if (tip !== "safe") {
      this.setAlert({
        id: "tip:EXC001",
        kind: "tip_over",
        severity: tip === "critical" ? "critical" : "warning",
        title: tip === "critical" ? "STABILITY CRITICAL" : "STABILITY WARNING",
        message: "TIP-OVER MARGIN LOW",
        machineId: PRIMARY_MACHINE,
        detail: {
          Margin: p.tipOverMargin.toFixed(2),
          Slope: `${(Math.hypot(p.pitch, p.roll) / DEG).toFixed(1)}°`,
          Payload: `${Math.round(p.payload)} kg`,
        },
        recommendation: "RETRACT ARM / LEVEL MACHINE",
      });
    } else {
      this.clearAlert("tip:EXC001");
    }

    // --- Machine health --------------------------------------------------
    if (p.hydraulicTemperature > 92) {
      this.setAlert({
        id: "hyd:EXC001",
        kind: "hydraulic",
        severity: p.hydraulicTemperature > 100 ? "critical" : "warning",
        title: "HYDRAULIC TEMPERATURE",
        message: "OIL TEMPERATURE ABOVE LIMIT",
        machineId: PRIMARY_MACHINE,
        detail: { Temperature: `${p.hydraulicTemperature.toFixed(0)}°C`, Limit: "92°C" },
        recommendation: "IDLE TO COOL / CHECK COOLER",
      });
    } else {
      this.clearAlert("hyd:EXC001");
    }

    if (p.fuel < 15) {
      this.setAlert({
        id: "fuel:EXC001",
        kind: "fuel",
        severity: p.fuel < 8 ? "critical" : "warning",
        title: "LOW FUEL",
        message: "REFUEL REQUIRED",
        machineId: PRIMARY_MACHINE,
        detail: { Level: `${p.fuel.toFixed(0)}%` },
        recommendation: "PROCEED TO FUEL STATION",
      });
    } else {
      this.clearAlert("fuel:EXC001");
    }

    if (this.engineWarningLeft > 0) {
      this.setAlert({
        id: "engine:EXC001",
        kind: "engine",
        severity: "warning",
        title: "ENGINE FAULT",
        message: "ECM CODE 1247-3",
        machineId: PRIMARY_MACHINE,
        detail: { System: "AFTERTREATMENT", Severity: "DERATE PENDING" },
        recommendation: "SCHEDULE SERVICE",
      });
    } else {
      this.clearAlert("engine:EXC001");
    }

    if (this.emergencyStopped) {
      this.setAlert({
        id: "estop:EXC001",
        kind: "emergency_stop",
        severity: "critical",
        title: "EMERGENCY STOP",
        message: "MACHINE DISABLED BY OPERATOR",
        machineId: PRIMARY_MACHINE,
        detail: { Source: "CAB E-STOP" },
        recommendation: "PRESS SPACE TO RELEASE",
      });
    } else {
      this.clearAlert("estop:EXC001");
    }

    if (this.weather === "rain") {
      this.setAlert({
        id: "weather:site",
        kind: "weather",
        severity: "warning",
        title: "RAIN DETECTED",
        message: "REDUCED TRACTION AND VISIBILITY",
        machineId: "SITE",
        detail: { Grip: "82%", Visibility: "REDUCED" },
        recommendation: "REDUCE SPEED ON GRADES",
      });
    } else if (this.weather === "fog") {
      this.setAlert({
        id: "weather:site",
        kind: "weather",
        severity: "warning",
        title: "FOG ADVISORY",
        message: "VISIBILITY BELOW 60 M",
        machineId: "SITE",
        detail: { Visibility: "< 60 m" },
        recommendation: "USE SPOTTERS AT INTERSECTIONS",
      });
    } else if (this.weather === "heat") {
      this.setAlert({
        id: "weather:site",
        kind: "weather",
        severity: "warning",
        title: "HEAT ADVISORY",
        message: "AMBIENT 44°C",
        machineId: "SITE",
        detail: { Ambient: "44°C", Risk: "HYDRAULIC OVERHEAT" },
        recommendation: "MONITOR OIL TEMPERATURE",
      });
    } else {
      this.clearAlert("weather:site");
    }
  }

  /** Fires feed entries on state transitions only. */
  private emitEvents(): void {
    const p = this.primary;

    const moving = Math.abs(p.speed) > 0.4;
    if (moving !== this.flags.moving) {
      this.flags.moving = moving;
      this.pushEvent(
        moving ? `${PRIMARY_MACHINE} started moving` : `${PRIMARY_MACHINE} stopped`,
        "info",
      );
    }

    const zone = zoneAt(p.x, p.z);
    const zoneId = zone?.id ?? "";
    if (zoneId !== this.flags.zoneId) {
      this.flags.zoneId = zoneId;
      if (zone) {
        this.pushEvent(
          `${PRIMARY_MACHINE} entered ${zone.label}`,
          zone.kind === "restricted" ? "critical" : "info",
        );
      }
    }

    const prox = this.proximity.level;
    if (prox !== this.flags.proximity) {
      const previous = this.flags.proximity;
      this.flags.proximity = prox;
      const id = this.proximity.nearestWorkerId ?? "WORKER";
      const d = this.proximity.nearest.toFixed(1);
      if (prox === "warning" && levelRank(previous) < 1) {
        this.pushEvent(`${id} detected ${d} m from ${PRIMARY_MACHINE}`, "warning");
        this.pushEvent("Proximity warning", "warning");
      } else if (prox === "critical") {
        this.pushEvent(`Critical proximity alert — ${id} at ${d} m`, "critical");
      } else if (prox === "safe") {
        this.pushEvent("Proximity clear", "info");
      }
    }

    const tip = tipOverLevel(p.tipOverMargin);
    if (tip !== this.flags.tipOver) {
      this.flags.tipOver = tip;
      if (tip === "warning") this.pushEvent("Stability margin degraded", "warning");
      if (tip === "critical") this.pushEvent("Tip-over risk critical", "critical");
    }

    const lowFuel = p.fuel < 15;
    if (lowFuel !== this.flags.lowFuel) {
      this.flags.lowFuel = lowFuel;
      if (lowFuel) this.pushEvent(`${PRIMARY_MACHINE} low fuel ${p.fuel.toFixed(0)}%`, "warning");
    }

    const hotOil = p.hydraulicTemperature > 92;
    if (hotOil !== this.flags.hotOil) {
      this.flags.hotOil = hotOil;
      this.pushEvent(
        hotOil
          ? `Hydraulic temperature ${p.hydraulicTemperature.toFixed(0)}°C`
          : "Hydraulic temperature normal",
        hotOil ? "warning" : "info",
      );
    }

    const hasRisk = this.risks.length > 0;
    if (hasRisk !== this.flags.collision) {
      this.flags.collision = hasRisk;
      if (hasRisk) {
        const r = this.risks[0];
        this.pushEvent(`Predicted conflict ${r.a} → ${r.b}`, "warning");
      }
    }
  }

  pushEvent(text: string, severity: AlertSeverity = "info"): void {
    const now = new Date();
    this.events.unshift({
      id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      time: now.toLocaleTimeString("en-GB", { hour12: false }),
      text,
      severity,
    });
    if (this.events.length > 40) this.events.length = 40;
  }

  /* --------------------------------------------------------------------- */
  /*  Snapshot for the UI layer                                             */
  /* --------------------------------------------------------------------- */

  get siteSafety(): ProximityLevel {
    let level: ProximityLevel = this.proximity.level;

    const tip = tipOverLevel(this.primary.tipOverMargin);
    if (tip !== "safe") level = worstLevel(level, tip === "critical" ? "critical" : "warning");

    if (this.risks.length > 0) {
      const worst = this.risks[0].separation < 5 ? "critical" : "warning";
      level = worstLevel(level, worst);
    }
    if (this.emergencyStopped) level = worstLevel(level, "critical");
    if (this.weather !== "clear") level = worstLevel(level, "warning");

    return level;
  }

  snapshot(): UiSnapshot {
    const active = this.tasks[this.activeTaskIndex] ?? null;
    return {
      tick: this.tick,
      primary: { ...this.primary },
      machines: this.allTelemetry().map((t) => ({ ...t })),
      workers: this.liveWorkers().map((w) => ({ ...w })),
      proximity: {
        ...this.proximity,
        readings: this.proximity.readings.map((r) => ({ ...r })),
      },
      risks: this.risks.map((r) => ({ ...r })),
      alerts: Array.from(this.alerts.values()).sort(
        (a, b) => severityRank(b.severity) - severityRank(a.severity),
      ),
      events: this.events.slice(0, 18),
      tasks: this.tasks.map((t) => ({ ...t })),
      activeTask: active ? { ...active } : null,
      siteSafety: this.siteSafety,
      weather: this.weather,
      paused: this.paused,
      source: this.source,
      emergencyStopped: this.emergencyStopped,
      engineWarning: this.engineWarningLeft > 0,
      linkStatus: this.linkStatus,
      linkDetail: this.linkDetail,
      liveMachines: this.liveTargets.size,
      fps: this.fps,
      clock: this.clockOverride ?? new Date().toLocaleTimeString("en-GB", { hour12: false }),
      replay: this.replay
        ? {
            incidentId: this.replay.track.incidentId,
            type: this.replay.track.type,
            severity: this.replay.track.severity,
            machineId: this.replay.track.machineId,
            shownOn: this.replay.machineId,
            progress: this.replayProgress,
            durationS: this.replay.track.durationS,
          }
        : null,
      physics: this.physics
        ? {
            ...this.physics.stats,
            active: this.physicsActive,
            materialTonnes: this.physics.material.tonnes(),
            faceFailed: this.physics.face.released,
            contacts: Array.from(this.physics.touching.keys()),
          }
        : null,
      scenario: (() => {
        const st = this.scenarios.status();
        return st ? { ...st, met: st.met.map((m) => ({ ...m })), focus: this.scenarios.focus } : null;
      })(),
    };
  }

  /* --------------------------------------------------------------------- */
  /*  Physics scenarios                                                     */
  /* --------------------------------------------------------------------- */

  /** Every scenario the director can run. */
  get physicsScenarios() {
    return PHYSICS_SCENARIOS;
  }

  /** Starts a library scenario by id. False if physics is not running locally. */
  runScenario(id: string): boolean {
    const def = getPhysicsScenario(id);
    if (!def) return false;
    if (!this.physics || this.physicsSuspended || this.replay || this.source === "websocket") {
      this.pushEvent(`${def.title}: needs the local physics simulation`, "warning");
      return false;
    }
    return this.scenarios.start(def, this);
  }

  stopScenario(): void {
    this.scenarios.stop(this);
  }

  /** Forgets route-AI manoeuvre state, so a machine handed back resumes cleanly. */
  clearAi(id: string): void {
    this.yielding.delete(id);
    this.recovering.delete(id);
    this.stalledFor.delete(id);
    this.blockedFor.delete(id);
  }

  /* --------------------------------------------------------------------- */
  /*  Commands                                                              */
  /* --------------------------------------------------------------------- */

  toggleEmergencyStop(): void {
    this.emergencyStopped = !this.emergencyStopped;
    this.pushEvent(
      this.emergencyStopped
        ? `${PRIMARY_MACHINE} EMERGENCY STOP engaged`
        : `${PRIMARY_MACHINE} emergency stop released`,
      this.emergencyStopped ? "critical" : "info",
    );
  }

  resetMachine(): void {
    this.emergencyStopped = false;
    this.modelOf(PRIMARY_MACHINE).reset(
      EXCAVATOR_HOME.x,
      EXCAVATOR_HOME.z,
      EXCAVATOR_HOME.heading,
    );
    this.primary.fuel = 67;
    this.primary.hydraulicTemperature = 64;
    this.hydraulicSpike = 0;
    this.tipOverBias = { pitch: 0, roll: 0 };
    this.tipOverLeft = 0;
    this.pushEvent(`${PRIMARY_MACHINE} reset to home position`, "info");
  }

  setWeather(mode: WeatherMode): void {
    if (this.weather === mode) return;
    this.weather = mode;
    this.pushEvent(`Weather changed to ${mode.toUpperCase()}`, mode === "clear" ? "info" : "warning");
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pushEvent(paused ? "Simulation paused" : "Simulation resumed", "info");
  }

  /**
   * Switches the telemetry source. Exactly one is ever active, and each is torn
   * down before the next starts, so switching is safe at any moment.
   */
  setSource(source: TelemetrySource): void {
    if (this.source === source) return;

    this.stopMock();
    this.stopLive();
    this.source = source;

    if (source === "mock_iot") {
      this.startMock();
      this.pushEvent("Telemetry source → MOCK IOT generator", "info");
      return;
    }
    if (source === "websocket") {
      this.startLive();
      this.pushEvent("Telemetry source → LIVE SIMULATOR", "info");
      return;
    }

    // Back to the keyboard: hand the physics model the machine where the
    // previous source left it, so control resumes without a jump.
    const model = this.modelOf(PRIMARY_MACHINE);
    model.yawRate = 0;
    model.armRate = { boom: 0, stick: 0, bucket: 0, swing: 0 };
    this.pushEvent("Telemetry source → KEYBOARD", "info");
  }

  private startLive(): void {
    this.stopLive();
    const provider = new WebSocketTelemetryProvider({
      onStatus: (status, detail) => {
        this.linkStatus = status;
        this.linkDetail = detail;
        if (status === "live") this.pushEvent("Live telemetry link established", "info");
        if (status === "unavailable") {
          this.pushEvent(`Live link unavailable — ${detail}`, "warning");
        }
      },
      onWorkers: (workers) => {
        this.liveWorkerTargets.clear();
        for (const w of workers) this.liveWorkerTargets.set(w.id, w);
      },
      onEnvironment: (env) => {
        // The simulator has a `wind` state the twin has no look for; it reads
        // as ordinary conditions, so it maps to clear.
        const map: Record<string, WeatherMode> = {
          clear: "clear",
          wind: "clear",
          rain: "rain",
          fog: "fog",
          heat: "heat",
        };
        const mode = map[env.weather] ?? "clear";
        if (mode !== this.weather) {
          this.setWeather(mode);
          this.pushEvent(
            `Site conditions from simulator — ${env.weather}, visibility ${env.visibility_m} m`,
            mode === "clear" ? "info" : "warning",
          );
        }
      },
      onEvent: (event) => {
        // The simulator's own safety events go straight into the twin's feed.
        const severity: AlertSeverity =
          event.severity === "critical"
            ? "critical"
            : event.severity === "high" || event.severity === "medium"
              ? "warning"
              : "info";
        this.pushEvent(event.message, severity);
      },
    });

    this.liveProvider = provider;
    this.unsubscribeLive = provider.subscribe((frames) => {
      for (const frame of frames) this.liveTargets.set(frame.machineId, frame);
    });
    provider.start();
  }

  private stopLive(): void {
    this.liveProvider?.stop();
    this.unsubscribeLive?.();
    this.liveProvider = null;
    this.unsubscribeLive = null;
    this.liveTargets.clear();
    this.liveWorkerTargets.clear();
    this.liveSeen.clear();
    this.linkStatus = "idle";
    this.linkDetail = "";
  }

  private startMock(): void {
    this.stopMock();
    const model = new VehicleModel({ ...this.primary }, TUNING.excavator);
    this.mockModel = model;
    this.mockProvider = new MockTelemetryProvider(
      () => ({ ...this.primary }),
      (t, input, dt) => {
        model.telemetry = t;
        model.step(input, dt, { ...this.stepContext(), emergencyStopped: false });
      },
    );
    this.unsubscribeMock = this.mockProvider.subscribe((frames) => {
      this.pendingFrame = frames[0] ?? null;
    });
    this.mockProvider.start();
  }

  private stopMock(): void {
    this.mockProvider?.stop();
    this.unsubscribeMock?.();
    this.mockProvider = null;
    this.mockModel = null;
    this.unsubscribeMock = null;
    this.pendingFrame = null;
  }

  dispose(): void {
    this.stopMock();
    this.stopLive();
  }

  /* --------------------------------------------------------------------- */
  /*  Director-panel hazards                                                */
  /* --------------------------------------------------------------------- */

  forceWorkerApproach(): void {
    const p = this.primary;
    const runtime =
      this.workers.find((w) => w.worker.id === SPOTTER_ID) ?? this.workers[0];

    // Drop the worker just outside the sensor ring so the bubble visibly
    // transitions green -> amber -> red instead of snapping to red.
    const bearing = Math.random() * Math.PI * 2;
    const distance = PROXIMITY.warning + 3;
    runtime.worker.x = clamp(p.x + Math.sin(bearing) * distance, -SITE_HALF, SITE_HALF);
    runtime.worker.z = clamp(p.z + Math.cos(bearing) * distance, -SITE_HALF, SITE_HALF);
    runtime.approachLeft = 20;
    runtime.approachCooldown = 70;
    this.pushEvent(`${runtime.worker.id} entering ${PRIMARY_MACHINE} safety zone`, "warning");
  }

  /**
   * Test bench: stand the spotter on one side of the primary machine at an
   * exact distance, and hold them there. Sides are relative to the tracks'
   * heading, so "rear" is behind the machine whichever way it faces.
   */
  placeWorker(side: "front" | "rear" | "left" | "right", distance: number, holdS = 25): void {
    const p = this.primary;
    const runtime = this.workers.find((w) => w.worker.id === SPOTTER_ID) ?? this.workers[0];
    const offset = { front: 0, right: Math.PI / 2, rear: Math.PI, left: -Math.PI / 2 }[side];
    const f = headingVector(p.heading + offset);
    runtime.worker.x = clamp(p.x + f.x * distance, -SITE_HALF, SITE_HALF);
    runtime.worker.z = clamp(p.z + f.z * distance, -SITE_HALF, SITE_HALF);
    runtime.worker.heading = headingTo(runtime.worker.x, runtime.worker.z, p.x, p.z);
    runtime.approachLeft = 0;
    runtime.pinnedLeft = holdS;
    runtime.approachCooldown = Math.max(runtime.approachCooldown, holdS + 30);
    this.pushEvent(`${runtime.worker.id} placed ${distance.toFixed(1)} m ${side} of ${PRIMARY_MACHINE}`, "warning");
  }

  /** Scenario playback: hand the primary machine to an external frame driver, or take it back. */
  setDriver(driver: ((dt: number) => void) | null, clock: string | null = null): void {
    this.driver = driver;
    this.clockOverride = driver ? clock : null;
  }

  get driven(): boolean {
    return this.driver !== null;
  }

  /** Scenario playback: hold the spotter at an exact spot this frame. */
  holdSpotterAt(x: number, z: number, heading: number, walking: boolean): void {
    const runtime = this.workers.find((w) => w.worker.id === SPOTTER_ID) ?? this.workers[0];
    runtime.worker.x = x;
    runtime.worker.z = z;
    runtime.worker.heading = heading;
    runtime.worker.state = walking ? "walking" : "working";
    runtime.pinnedLeft = 0.5;
    runtime.approachLeft = 0;
    runtime.approachCooldown = Math.max(runtime.approachCooldown, 60);
  }

  /** Test bench: send every worker well clear of the primary machine. */
  clearWorkers(): void {
    const p = this.primary;
    for (const runtime of this.workers) {
      const dx = runtime.worker.x - p.x;
      const dz = runtime.worker.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < 25) {
        runtime.worker.x = clamp(p.x + (dx / d) * 28, -SITE_HALF, SITE_HALF);
        runtime.worker.z = clamp(p.z + (dz / d) * 28, -SITE_HALF, SITE_HALF);
      }
      runtime.pinnedLeft = 0;
      runtime.approachLeft = 0;
      runtime.approachCooldown = 90;
    }
    this.pushEvent(`Work zone around ${PRIMARY_MACHINE} cleared`, "info");
  }

  /**
   * With physics running this is the "dozer-intercept" scenario: the dozer
   * closes with its V2V braking faulted, the conflict is predicted, and the
   * blade meets the excavator. Before physics has loaded, the original
   * kinematic intercept runs instead.
   */
  forceCollisionRisk(): void {
    if (this.physics && !this.physicsSuspended && this.runScenario("dozer-intercept")) return;
    this.forcedCollisionLeft = 14;
    const dozer = this.telemetryOf("DOZ001");
    const p = this.primary;
    // Reposition the dozer onto an intercept so the conflict is immediate.
    const bearing = headingTo(p.x, p.z, dozer.x, dozer.z);
    dozer.x = p.x + Math.sin(bearing) * 34;
    dozer.z = p.z - Math.cos(bearing) * 34;
    dozer.heading = headingTo(dozer.x, dozer.z, p.x, p.z);
    dozer.speed = 2.2;
    this.pushEvent("DOZ001 on intercept course with EXC001", "warning");
  }

  /**
   * With physics running this is the "load-shift-tipover" scenario: a loaded
   * bucket swung out over the downhill side of the sidehill bench. The
   * stability alert fires from the physical attitude, and if the load shifts
   * far enough the machine really goes over. Before physics, the original
   * injected-grade version runs.
   */
  forceTipOver(): void {
    if (this.physics && this.runScenario("load-shift-tipover")) return;
    this.tipOverBias = { pitch: 0.06, roll: 0.24 };
    this.tipOverLeft = 14;
    this.primary.payload = MAX_PAYLOAD;
    this.pushEvent("Stability event injected — machine on adverse grade", "critical");
  }

  forceHydraulicSpike(): void {
    const p = this.primary;
    this.hydraulicSpike = Math.max(0, 97 - p.hydraulicTemperature) + 8;
    p.hydraulicTemperature = 97;
    this.pushEvent("Hydraulic temperature spike 97°C", "warning");
  }

  forceLowFuel(): void {
    this.primary.fuel = 11;
    this.pushEvent(`${PRIMARY_MACHINE} fuel level 11%`, "warning");
  }

  forceEngineWarning(): void {
    this.engineWarningLeft = 30;
    this.pushEvent("Engine fault ECM 1247-3 raised", "warning");
  }

  resetSimulation(): void {
    this.scenarios.abandon();
    this.stopMock();
    this.stopLive();
    this.replay = null;
    this.selectedForReplay = null;
    this.telemetry.clear();
    this.models.clear();
    this.agents = [];
    this.alerts.clear();
    this.events = [];
    this.workers = [];
    this.activeTaskIndex = 0;
    this.emergencyStopped = false;
    this.paused = false;
    this.weather = "clear";
    this.source = "keyboard";
    this.hydraulicSpike = 0;
    this.engineWarningLeft = 0;
    this.tipOverLeft = 0;
    this.tipOverBias = { pitch: 0, roll: 0 };
    this.forcedCollisionLeft = 0;
    this.wetness = 0;
    this.fogAmount = 0;
    this.risks = [];
    this.paths.clear();
    this.timedAlerts.clear();
    this.blockedFor.clear();
    this.yielding.clear();
    this.stalledFor.clear();
    this.recovering.clear();
    this.overrides.clear();
    this.avoidanceOff.clear();
    this.flags = {
      moving: false,
      zoneId: "",
      proximity: "safe",
      tipOver: "safe",
      lowFuel: false,
      hotOil: false,
      collision: false,
    };
    this.build();
    if (this.physics) {
      this.physics.resetSite();
      this.attachFleet();
    }
  }
}

/** Who gives way to whom in physical traffic: higher keeps going. */
function rightOfWay(id: string): number {
  if (id === PRIMARY_MACHINE) return 9;
  return id.startsWith("TRK") ? 3 : id.startsWith("WHL") ? 2 : 1;
}

/** Implement pose for a non-excavator from its activity and load. */
function poseImplements(kind: MachineDescriptor["kind"], t: MachineTelemetry, dt: number): void {
  const working = t.activity === "digging";
  const dumping = t.activity === "loading";
  let boom = t.boomAngle;
  let bucket = t.bucketAngle;
  let swing = t.swingAngle;

  if (kind === "loader") {
    if (working) [boom, bucket] = [0, 0.6];
    else if (dumping) [boom, bucket] = [0.92, -0.75];
    else [boom, bucket] = t.payload > 500 ? [0.3, 0.7] : [0.08, 0];
  } else if (kind === "truck") {
    const onDump = Math.hypot(t.x - DUMP_POINT.x, t.z - DUMP_POINT.z) < 26;
    boom = 0;
    bucket = onDump && Math.abs(t.speed) < 0.3 && t.payload < 2000 ? -1 : 0;
  } else if (kind === "bulldozer") {
    boom = working ? -0.06 : 0.3;
    bucket = 0;
  } else if (kind === "grader") {
    boom = working ? -0.04 : 0.25;
    swing = working ? 0.5 : 0.2;
  }

  t.boomAngle = damp(t.boomAngle, boom, 2.5, dt);
  t.bucketAngle = damp(t.bucketAngle, bucket, 2, dt);
  t.swingAngle = damp(t.swingAngle, swing, 1.5, dt);
}

const SERVICE_POINTS = [LOADER_POINT, DUMP_POINT, STOCKPILE_POINT, EMPTY_ROUTE[4]];
const SERVICE_RADIUS_M = 30;

function atServicePoint(x: number, z: number): boolean {
  return SERVICE_POINTS.some((p) => Math.hypot(x - p.x, z - p.z) < SERVICE_RADIUS_M);
}

function severityRank(s: AlertSeverity): number {
  return s === "critical" ? 2 : s === "warning" ? 1 : 0;
}

/** Ground height helper re-exported for scene props. */
export { terrainHeight, proximityLevel };
