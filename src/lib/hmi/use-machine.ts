"use client";

/**
 * The display's view of the machine, read from the 3D twin, plus the monitor
 * loop that turns what the operator is doing into alerts and incidents.
 */
import * as React from "react";
import { useTwinStore } from "@/store/twinStore";
import { PRIMARY_MACHINE } from "@/lib/twin/simulation";
import { angleDelta, headingTo } from "@/lib/twin/site";
import { PROXIMITY } from "@/lib/twin/proximity";
import { CAMERA_CHECKS, cameraActive, useHmiStore, type AlertLevel } from "./hmi-store";

export type Side = "front" | "rear" | "left" | "right";

export interface LiveMachine {
  id: string;
  speedKmh: number;
  gear: "D" | "N" | "R";
  rpm: number;
  fuel: number;
  hydraulicC: number;
  tipOver: number;
  payloadKg: number;
  activity: string;
  estop: boolean;
  weather: "clear" | "rain" | "fog" | "heat";
  proximity: { level: "safe" | "warning" | "critical"; distance: number | null; side: Side | null };
  clock: string;
}

function sideOf(heading: number, px: number, pz: number, wx: number, wz: number): Side {
  const rel = angleDelta(heading, headingTo(px, pz, wx, wz));
  const a = Math.abs(rel);
  if (a < Math.PI / 4) return "front";
  if (a > (3 * Math.PI) / 4) return "rear";
  return rel > 0 ? "right" : "left";
}

/** 12 Hz view of the primary machine, from the twin's HUD snapshot. */
export function useLiveMachine(): LiveMachine {
  const snap = useTwinStore((s) => s.snapshot);
  const t = snap.primary;
  const nearestWorker = snap.workers.reduce<{ d: number; x: number; z: number } | null>((best, w) => {
    const d = Math.hypot(w.x - t.x, w.z - t.z);
    return !best || d < best.d ? { d, x: w.x, z: w.z } : best;
  }, null);
  const distance = nearestWorker ? nearestWorker.d : null;
  const level = distance === null || distance > PROXIMITY.warning ? "safe" : distance > PROXIMITY.critical ? "warning" : "critical";
  const speedKmh = t.speed * 3.6;
  return {
    id: PRIMARY_MACHINE,
    speedKmh,
    gear: speedKmh > 0.2 ? "D" : speedKmh < -0.2 ? "R" : "N",
    rpm: t.engineRpm,
    fuel: t.fuel,
    hydraulicC: t.hydraulicTemperature,
    tipOver: t.tipOverMargin,
    payloadKg: t.payload,
    activity: t.activity,
    estop: snap.emergencyStopped,
    weather: snap.weather,
    proximity: {
      level,
      distance,
      side: nearestWorker && level !== "safe" ? sideOf(t.heading, t.x, t.z, nearestWorker.x, nearestWorker.z) : null,
    },
    clock: snap.clock,
  };
}

export interface IncidentSink {
  (input: { title: string; kind: "seatbelt" | "proximity" | "fatigue" | "anomaly" | "tip_over"; severity: "critical" | "warning" | "info"; summary: string }): void;
}

const TICK_MS = 250;
const IDLE_ALERT_S = 45;
/** m/s². Full-pedal travel accelerates at about 1.2, so only violent inputs exceed this. */
const HARSH_ACCEL = 2.6;

/**
 * The monitor loop. Mounted once by the display. Reads the engine directly
 * (not React state) so it sees every tick, and writes alerts to the store.
 */
export function useMachineMonitor(report: IncidentSink): void {
  const reportRef = React.useRef(report);
  React.useEffect(() => {
    reportRef.current = report;
  }, [report]);

  React.useEffect(() => {
    let lastSpeed = 0;
    let lastHarshAt = 0;
    let lastProx: string = "safe";
    let lastTip = "ok";
    const loggedCamera = new Set<string>();

    const id = window.setInterval(() => {
      const twin = useTwinStore.getState();
      const engine = twin.engine;
      const t = engine.primary;
      const hmi = useHmiStore.getState();
      const dt = TICK_MS / 1000;
      const now = Date.now();
      const raise = (key: string, level: AlertLevel, title: string, action: string, source: "monitor" | "camera" | "machine" = "monitor") =>
        hmi.raise({ key, level, title, action, source });

      /* ---- seatbelt interlock: a real lockout, via the machine's e-stop ---- */
      if (hmi.seatbelt === "unfastened") {
        hmi.addBeltOff(dt);
        if (!hmi.interlock) {
          if (!engine.emergencyStopped) twin.toggleEmergencyStop();
          hmi.setInterlock(true);
        }
        if (raise("seatbelt", 3, "Seatbelt unfastened", "Hydraulics and travel locked until the belt is fastened.")) {
          reportRef.current({ title: "Seatbelt unfastened", kind: "seatbelt", severity: "critical", summary: "Seatbelt opened in the cab. Display applied the hydraulic lockout." });
          hmi.countIncident();
        }
      } else if (hmi.interlock) {
        if (engine.emergencyStopped) twin.toggleEmergencyStop();
        hmi.setInterlock(false);
        hmi.resolve("seatbelt");
      }

      /* ---- idling: stationary, arm still, engine running ---- */
      const idle = Math.abs(t.speed) < 0.1 && t.activity === "idle" && !engine.emergencyStopped;
      if (idle) {
        hmi.addIdle(dt, true);
        if (useHmiStore.getState().idleStreak > IDLE_ALERT_S) {
          raise("idle", 1, "Excessive idling", "Engine idling with no work. Shut down if you'll wait more than 5 minutes.");
        }
      } else if (hmi.idleStreak > 0) {
        hmi.resetIdleStreak();
        hmi.resolve("idle");
      }

      /* ---- harsh operation: violent speed changes or snap reversals ---- */
      const accel = (t.speed - lastSpeed) / dt;
      const reversal = Math.sign(t.speed) !== Math.sign(lastSpeed) && Math.abs(t.speed) > 0.4 && Math.abs(lastSpeed) > 0.4;
      if ((Math.abs(accel) > HARSH_ACCEL || reversal) && now - lastHarshAt > 4000) {
        lastHarshAt = now;
        hmi.addHarsh(1);
        if (raise("harsh", 2, "Harsh operation", reversal ? "Direction snapped while moving. Stop fully before reversing." : "Abrupt speed change. Feather the controls.")) {
          window.setTimeout(() => useHmiStore.getState().resolve("harsh"), 8000);
        }
      }
      lastSpeed = t.speed;

      /* ---- proximity: incident on escalation to critical ---- */
      const prox = twin.snapshot.proximity.level;
      if (prox === "critical" && lastProx !== "critical") {
        reportRef.current({ title: "Person inside the danger zone", kind: "proximity", severity: "critical", summary: `Worker ${twin.snapshot.proximity.nearest.toFixed(1)} m from ${PRIMARY_MACHINE}.` });
        hmi.countIncident();
      }
      lastProx = prox;

      /* ---- stability ---- */
      const tip = t.tipOverMargin < 1.2 ? "crit" : "ok";
      if (tip === "crit" && lastTip !== "crit") {
        reportRef.current({ title: "Stability margin critical", kind: "tip_over", severity: "critical", summary: `Tip-over margin ${t.tipOverMargin.toFixed(2)}.` });
        hmi.countIncident();
      }
      lastTip = tip;

      /* ---- working conditions ---- */
      // The twin raises its own heat advisory in heat weather; this covers a hot day logged as another weather.
      if (hmi.ambientC >= 40 && twin.snapshot.weather !== "heat") raise("heat", 2, "Heat stress risk", `${hmi.ambientC}°C in the cab area. Hydrate every 20 minutes and watch hydraulic temperature.`);
      else hmi.resolve("heat");
      // Rain and fog alerts come from the twin itself; not duplicated here.

      /* ---- operator camera ---- */
      for (const c of CAMERA_CHECKS) {
        const key = `cam-${c.id}`;
        if (cameraActive(hmi.camera, c.id)) {
          if (raise(key, c.level, c.title, c.action, "camera") && c.level === 3 && !loggedCamera.has(key)) {
            loggedCamera.add(key);
            reportRef.current({ title: c.title, kind: "fatigue", severity: "critical", summary: `Operator camera: ${c.action}` });
            hmi.countIncident();
          }
        } else {
          hmi.resolve(key);
          loggedCamera.delete(key);
        }
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);
}
