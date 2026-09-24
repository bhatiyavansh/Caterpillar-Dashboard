"use client";

/**
 * Runs a guided lesson: validator on every animation frame, coach at step
 * boundaries only.
 *
 * The frame loop reads the engine's mutated-in-place telemetry directly and
 * pushes to React at ~10 Hz for the progress bar and readout. The LLM is never
 * between a keypress and the ✓: the scripted line shows instantly, and the
 * model's line replaces it when it arrives (≈4-12 s on CPU).
 */
import * as React from "react";
import { useTwinStore } from "@/store/twinStore";
import type { MachineTelemetry } from "@/types/twin";
import profiles from "../../../fixtures/training_profiles.json";
import { CURRICULUM, TOTAL_STEPS, keyLabel, type LessonModule, type LessonStep } from "./curriculum";
import { StepValidator } from "./validator";
import type { CoachEvent, CoachRequest, CoachResponse, CoachTool } from "./coach-types";

export type LearnerProfile = (typeof profiles)[number];
export const LEARNERS: LearnerProfile[] = profiles;

export type LessonPhase =
  | "idle"
  | "running"
  | "passed"      // a step passed; a beat before the next one
  | "retrying"
  | "levelDone"   // every step in this level is done - wait for the learner
  | "finished";   // the last level is done

export interface CoachLine {
  id: number;
  text: string;
  source: "live" | "scripted";
  tool: CoachTool;
  citation: CoachResponse["citation"];
  /** True while the model is still composing a replacement for this line. */
  thinking: boolean;
}

export interface StepResult {
  stepId: string;
  ms: number;
  attempts: number;
  score: number;
}

export interface LessonState {
  phase: LessonPhase;
  moduleIdx: number;
  stepIdx: number;
  attempt: number;
  hold: number;
  elapsed: number;
  gauge: string;
  line: CoachLine | null;
  history: CoachLine[];
  results: StepResult[];
  coachLive: boolean | null;
  demo: boolean;
  /** The validator's diagnosis of the last failed attempt at this step (never a model's opinion). */
  lastReason: string | null;
}

const INITIAL: LessonState = {
  phase: "idle",
  moduleIdx: 0,
  stepIdx: 0,
  attempt: 1,
  hold: 0,
  elapsed: 0,
  gauge: "",
  line: null,
  history: [],
  results: [],
  coachLive: null,
  demo: false,
  lastReason: null,
};

const PASS_PAUSE_MS = 1800;

function digest(t: MachineTelemetry): string {
  const d = (r: number) => Math.round((r * 180) / Math.PI);
  const person = Number.isFinite(t.nearestPerson) ? `${t.nearestPerson.toFixed(1)} m` : "none";
  return `speed ${(t.speed * 3.6).toFixed(1)} km/h, heading ${d(t.heading)}°, slew ${d(t.swingAngle)}°, boom ${d(t.boomAngle)}°, nearest person ${person}, activity ${t.activity}`;
}

function scoreStep(step: LessonStep, ms: number, attempts: number): number {
  const slow = ms > step.timeoutMs / 2 ? 10 : 0;
  return Math.max(40, 100 - (attempts - 1) * 20 - slow);
}

export function useTrainingCoach(learner: LearnerProfile) {
  const [state, setState] = React.useState<LessonState>(INITIAL);
  const stateRef = React.useRef(state);
  React.useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  const validator = React.useRef<StepValidator | null>(null);
  const raf = React.useRef<number | null>(null);
  const lineId = React.useRef(0);
  const lastPush = React.useRef(0);
  const pauseTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The model serves one request at a time; a newer line cancels the older one. */
  const inFlight = React.useRef<AbortController | null>(null);

  const engine = () => useTwinStore.getState().engine;

  // Pre-warm the model so the first real line is not a cold start.
  React.useEffect(() => {
    let alive = true;
    fetch("/api/coach")
      .then((r) => r.json() as Promise<{ live: boolean }>)
      .then((d) => alive && setState((s) => ({ ...s, coachLive: d.live })))
      .catch(() => alive && setState((s) => ({ ...s, coachLive: false })));
    return () => {
      alive = false;
    };
  }, []);

  /** Show the scripted line now; swap in the model's line if it arrives in time. */
  const speak = React.useCallback(
    (event: CoachEvent, mod: LessonModule, step: LessonStep, scripted: string, extra?: { reason?: string; attempt?: number }) => {
      const id = ++lineId.current;
      // ~10 tok/s on CPU, one request at a time: spend the model where adapting
      // matters — introducing a module, and every failed attempt. Praise and
      // routine steps stay scripted so the queue never backs up.
      const worthAsking = event === "timeout" || (event === "brief" && mod.steps[0] === step);
      const provisional: CoachLine = {
        id,
        text: scripted,
        source: "scripted",
        tool: event === "timeout" ? "remediate" : "say",
        citation: null,
        thinking: worthAsking && stateRef.current.coachLive !== false,
      };
      setState((s) => ({ ...s, line: provisional, history: [...s.history, provisional].slice(-30) }));
      if (!provisional.thinking) return;

      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      const body: CoachRequest = {
        event,
        module: mod.title,
        step: step.brief,
        realControl: step.realControl,
        keys: step.keys.map((k) => (k === "Shift" ? "SHIFT" : keyLabel(k))),
        reason: extra?.reason,
        attempt: extra?.attempt ?? 1,
        digest: digest(engine().primary),
        learner: { name: learner.name.split(" ")[0], level: learner.skill, weakest: learner.weakest_skill.replace("_", " ") },
        scripted,
      };
      fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
        .then((r) => r.json() as Promise<CoachResponse>)
        .then((res) => {
          const next: CoachLine = { id, text: res.say, source: res.source, tool: res.tool, citation: res.citation, thinking: false };
          setState((s) => ({
            ...s,
            coachLive: res.source === "live" ? true : s.coachLive,
            demo: s.demo || res.tool === "demo",
            // Only replace the headline if the lesson hasn't moved on since.
            line: s.line?.id === id ? next : s.line,
            history: s.history.map((h) => (h.id === id ? next : h)),
          }));
        })
        .catch(() => {
          setState((s) => ({
            ...s,
            line: s.line?.id === id ? { ...s.line, thinking: false } : s.line,
            history: s.history.map((h) => (h.id === id ? { ...h, thinking: false } : h)),
          }));
        });
    },
    [learner],
  );

  const beginStep = React.useCallback(
    (moduleIdx: number, stepIdx: number, attempt: number, timeoutScale = 1) => {
      const mod = CURRICULUM[moduleIdx];
      const step = mod.steps[stepIdx];
      const store = useTwinStore.getState();
      if (step.setup === "spawn_worker" && attempt === 1) store.forceWorkerApproach();
      if (step.setup === "reset_machine") store.resetMachine();
      validator.current = new StepValidator(step, engine().primary, performance.now(), step.timeoutMs * timeoutScale);
      setState((s) => ({
        ...s, phase: "running", moduleIdx, stepIdx, attempt, hold: 0, elapsed: 0, demo: attempt > 2 || s.demo,
        lastReason: attempt === 1 ? null : s.lastReason,
      }));
      if (attempt === 1) speak("brief", mod, step, step.brief);
    },
    [speak],
  );

  const advance = React.useCallback(() => {
    const { moduleIdx, stepIdx } = stateRef.current;
    const mod = CURRICULUM[moduleIdx];
    if (stepIdx + 1 < mod.steps.length) return beginStep(moduleIdx, stepIdx + 1, 1);

    // End of a level. Stop here rather than rolling straight into the next
    // one: finishing a level is the thing the learner is working towards, and
    // running past it turns the ladder back into one long lesson.
    validator.current = null;
    setState((s) => ({
      ...s,
      phase: moduleIdx + 1 < CURRICULUM.length ? "levelDone" : "finished",
    }));
  }, [beginStep]);

  /** Called by the level-complete panel. Opens the next level. */
  const nextLevel = React.useCallback(() => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    const next = stateRef.current.moduleIdx + 1;
    if (next >= CURRICULUM.length) {
      setState((s) => ({ ...s, phase: "finished" }));
      return;
    }
    const store = useTwinStore.getState();
    store.resetMachine();
    if (store.engine.emergencyStopped) store.toggleEmergencyStop();
    beginStep(next, 0, 1);
  }, [beginStep]);

  /** Re-run the current level from its first step, keeping earlier results. */
  const replayLevel = React.useCallback(() => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    const { moduleIdx } = stateRef.current;
    const mod = CURRICULUM[moduleIdx];
    const ids = new Set(mod.steps.map((step) => step.id));
    const store = useTwinStore.getState();
    store.resetMachine();
    if (store.engine.emergencyStopped) store.toggleEmergencyStop();
    // Drop this level's results so the replay is scored on its own merits.
    setState((s) => ({ ...s, results: s.results.filter((r) => !ids.has(r.stepId)) }));
    beginStep(moduleIdx, 0, 1);
  }, [beginStep]);

  // The 60 Hz watcher.
  React.useEffect(() => {
    const loop = () => {
      raf.current = requestAnimationFrame(loop);
      const v = validator.current;
      const s = stateRef.current;
      if (!v || s.phase !== "running") return;
      const e = engine();
      const t = e.primary;
      const now = performance.now();
      const ev = v.tick(t, now, e.emergencyStopped);
      const step = v.step;
      const mod = CURRICULUM[s.moduleIdx];

      if (ev.kind === "pass") {
        const result: StepResult = { stepId: step.id, ms: ev.elapsedMs, attempts: s.attempt, score: scoreStep(step, ev.elapsedMs, s.attempt) };
        setState((p) => ({ ...p, phase: "passed", hold: 1, demo: false, results: [...p.results, result] }));
        speak("pass", mod, step, `✓ ${step.praise}`);
        pauseTimer.current = setTimeout(advance, PASS_PAUSE_MS);
        return;
      }
      if (ev.kind === "timeout") {
        const attempt = s.attempt + 1;
        setState((p) => ({ ...p, phase: "retrying", hold: 0, lastReason: ev.reason }));
        speak("timeout", mod, step, step.brief, { reason: ev.reason, attempt: s.attempt });
        // Remediation relaxes the clock, never the pass condition.
        pauseTimer.current = setTimeout(() => beginStep(s.moduleIdx, s.stepIdx, attempt, 1.5), 1200);
        return;
      }
      if (now - lastPush.current > 100) {
        lastPush.current = now;
        const gauge = step.gauge.read(t, v.context(now, e.emergencyStopped));
        setState((p) => ({ ...p, hold: ev.hold, elapsed: ev.elapsed, gauge }));
      }
    };
    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [advance, beginStep, speak]);

  React.useEffect(
    () => () => {
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
    },
    [],
  );

  const start = React.useCallback(
    (fromModule = 0) => {
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
      const store = useTwinStore.getState();
      store.resetMachine();
      if (store.engine.emergencyStopped) store.toggleEmergencyStop();
      store.setCameraMode("follow");
      // Keep results from other levels, drop any from the one being started —
      // replaying a level from the ladder must be scored on this run alone,
      // not on a stale pass still sitting in the list.
      const restarting = new Set(CURRICULUM[fromModule].steps.map((step) => step.id));
      setState((s) => ({
        ...INITIAL,
        coachLive: s.coachLive,
        results: s.results.filter((r) => !restarting.has(r.stepId)),
      }));
      beginStep(fromModule, 0, 1);
    },
    [beginStep],
  );

  const skip = React.useCallback(() => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    advance();
  }, [advance]);

  const stop = React.useCallback(() => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    validator.current = null;
    setState((s) => ({ ...INITIAL, coachLive: s.coachLive }));
  }, []);

  const done = state.results.length;
  const score = done ? Math.round(state.results.reduce((a, r) => a + r.score, 0) / done) : 0;

  // Just this level's results, for the level-complete panel to score.
  const currentModule = CURRICULUM[state.moduleIdx];
  const levelIds = new Set(currentModule.steps.map((step) => step.id));
  const levelResults = state.results.filter((r) => levelIds.has(r.stepId));
  const levelScore = levelResults.length
    ? Math.round(levelResults.reduce((a, r) => a + r.score, 0) / levelResults.length)
    : 0;
  const levelAttempts = levelResults.reduce((a, r) => a + r.attempts, 0);
  const levelMs = levelResults.reduce((a, r) => a + r.ms, 0);

  return {
    state,
    module: currentModule,
    step: currentModule.steps[state.stepIdx],
    progress: done / TOTAL_STEPS,
    score,
    levelResults,
    levelScore,
    levelAttempts,
    levelMs,
    isLastLevel: state.moduleIdx + 1 >= CURRICULUM.length,
    start,
    skip,
    stop,
    nextLevel,
    replayLevel,
  };
}
