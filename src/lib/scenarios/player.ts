"use client";

/**
 * Plays a generated scenario through the live system.
 *
 * The scenario's 120 Hz frames drive the primary excavator and the spotter
 * through the engine's external-driver hook, inside the engine's own frame
 * loop. Everything downstream is the real product: the twin's proximity and
 * stability alerts, the display's seatbelt interlock and camera checks, the
 * auto incident log. The player adds only the system *actions* from the
 * timeline (travel stop, swing hold) as display alerts.
 */
import { create } from "zustand";
import { useTwinStore } from "@/store/twinStore";
import { headingTo, headingVector } from "@/lib/twin/site";
import { useHmiStore } from "@/lib/hmi/hmi-store";
import { frameAt, getScenario, type Frame, type Phase, type ScenarioId } from "./generate";

const DEG = Math.PI / 180;
const UI_HZ = 12;

interface PlayerState {
  id: ScenarioId | null;
  t: number;
  playing: boolean;
  rate: number;
  done: boolean;
  phase: Phase;
  frame: Frame | null;
  start: (id: ScenarioId) => void;
  toggle: () => void;
  restart: () => void;
  setRate: (r: number) => void;
  seek: (t: number) => void;
  stop: () => void;
}

/** Playback clock, advanced by the engine; React only sees it at UI_HZ. */
const clock = { t: 0, playing: false, rate: 1, sinceUi: 0, fired: new Set<number>(), wall: 0 };

function applyFrame(f: Frame, origin: { x: number; z: number; heading: number }) {
  const twin = useTwinStore.getState();
  const e = twin.engine;
  const p = e.primary;
  const fwd = headingVector(origin.heading);
  const right = { x: Math.cos(origin.heading), z: Math.sin(origin.heading) };

  p.x = origin.x + fwd.x * f.travel;
  p.z = origin.z + fwd.z * f.travel;
  p.heading = origin.heading;
  p.speed = f.speed;
  p.swingAngle = f.swingDeg * DEG;
  p.boomAngle = f.boomDeg * DEG;
  p.stickAngle = f.stickDeg * DEG;
  p.bucketAngle = f.bucketDeg * DEG;
  p.payload = f.payloadKg;
  p.roll = f.rollDeg * DEG;
  p.pitch = 0;
  p.tipOverMargin = f.tipMargin;
  p.hydraulicTemperature = f.hydC;
  p.activity = Math.abs(f.speed) > 0.05 ? "traveling" : f.payloadKg > 0 ? "swinging" : "idle";

  const wx = origin.x + right.x * f.personRight + fwd.x * f.personFwd;
  const wz = origin.z + right.z * f.personRight + fwd.z * f.personFwd;
  e.holdSpotterAt(wx, wz, headingTo(wx, wz, p.x, p.z), f.personWalking);

  const hmi = useHmiStore.getState();
  const belt = f.seatbelt ? "fastened" : "unfastened";
  if (hmi.seatbelt !== belt) hmi.setSeatbelt(belt);
  if (Boolean(hmi.camera.simulated.drowsy) !== f.camDrowsy) hmi.simulate("drowsy", f.camDrowsy);
  if (Boolean(hmi.camera.simulated.yawn) !== f.camYawn) hmi.simulate("yawn", f.camYawn);
}

function restoreSite() {
  const twin = useTwinStore.getState();
  const e = twin.engine;
  e.setDriver(null);
  e.clearWorkers();
  twin.resetMachine();
  twin.setWeather("clear");
  if (e.emergencyStopped) twin.toggleEmergencyStop();
  useHmiStore.getState().reset();
  twin.refresh();
}

export const useScenarioPlayer = create<PlayerState>()((set, get) => ({
  id: null,
  t: 0,
  playing: false,
  rate: 1,
  done: false,
  phase: "normal",
  frame: null,

  start: (id) => {
    const s = getScenario(id);
    restoreSite();
    const twin = useTwinStore.getState();
    const e = twin.engine;
    const origin = { x: e.primary.x, z: e.primary.z, heading: e.primary.heading };
    twin.setWeather(s.weather);
    const hmi = useHmiStore.getState();
    hmi.setAmbient(s.ambientC);

    clock.t = 0;
    clock.playing = true;
    clock.sinceUi = 0;
    clock.fired = new Set();

    clock.wall = performance.now();
    e.setDriver(() => {
      // Scenario time follows the wall clock, not the render loop, so a slow
      // GPU drops frames instead of slowing the incident down.
      const now = performance.now();
      const real = Math.min(0.25, (now - clock.wall) / 1000);
      clock.wall = now;
      if (clock.playing) clock.t = Math.min(s.duration, clock.t + real * clock.rate);
      const f = frameAt(s, clock.t);
      applyFrame(f, origin);

      // System actions from the timeline become display alerts as they happen.
      s.events.forEach((ev, i) => {
        if (ev.actor !== "system" || clock.fired.has(i) || clock.t < ev.t) return;
        clock.fired.add(i);
        const store = useHmiStore.getState();
        if (store.raise({ key: `scn-${id}-${i}`, level: ev.level, source: "monitor", title: ev.title, action: ev.detail })) {
          setTimeout(() => useHmiStore.getState().resolve(`scn-${id}-${i}`), 6000);
        }
      });

      clock.sinceUi += real;
      const finished = clock.t >= s.duration;
      if (clock.sinceUi >= 1 / UI_HZ || finished) {
        clock.sinceUi = 0;
        if (finished) clock.playing = false;
        set({ t: clock.t, phase: f.phase, frame: f, playing: clock.playing, done: finished });
      }
    }, s.clock);

    set({ id, t: 0, playing: true, done: false, phase: "normal", frame: s.frames[0], rate: clock.rate });
  },

  toggle: () => {
    const { id, done } = get();
    if (!id) return;
    if (done) return get().restart();
    clock.playing = !clock.playing;
    set({ playing: clock.playing });
  },

  restart: () => {
    const { id } = get();
    if (id) get().start(id);
  },

  setRate: (rate) => {
    clock.rate = rate;
    set({ rate });
  },

  seek: (t) => {
    const { id } = get();
    if (!id) return;
    clock.t = t;
    // Re-arm any system action after the new playhead.
    const s = getScenario(id);
    clock.fired = new Set(s.events.map((e, i) => (e.t < t ? i : -1)).filter((i) => i >= 0));
    set({ t, done: false });
  },

  stop: () => {
    clock.playing = false;
    restoreSite();
    set({ id: null, t: 0, playing: false, done: false, phase: "normal", frame: null });
  },
}));
