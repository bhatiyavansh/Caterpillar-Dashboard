/**
 * What the training instructor (the global assistant, training specialist)
 * knows about the trainee at the moment a question is asked.
 *
 * Pure: fed the lesson state, the lesson machine's telemetry and the lesson
 * simulator's own alerts/events, it returns the contract's `TrainingContext`.
 * Every verdict in it — phase, steps passed, the failure diagnosis — was
 * produced by the telemetry validator. Nothing here asks a model anything, and
 * the assistant is told it may explain these verdicts but never make them.
 *
 * Values are rounded and strings clipped to the contract's limits, so a long
 * coach line can never get a question refused.
 */
import type { TrainingAlert, TrainingContext, TrainingEventNote } from "@web/lib/stream";
import type { Alert, MachineTelemetry, SimEvent } from "@/types/twin";
import { CURRICULUM, keyLabel, type LessonModule, type LessonStep } from "./curriculum";
import type { TrainingProgress } from "./progress";

/** The slice of `LessonState` this needs (kept structural so the hook's type can grow freely). */
export interface LessonSnapshot {
  phase: NonNullable<TrainingContext["phase"]>;
  moduleIdx: number;
  stepIdx: number;
  attempt: number;
  lastReason?: string | null;
  line?: { text: string } | null;
  results: { stepId: string }[];
}

export interface LearnerSnapshot {
  name: string;
  skill: string;
  weakest_skill?: string;
}

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : undefined);
const round = (n: number, dp = 1) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : undefined);
const deg = (rad: number) => (Number.isFinite(rad) ? Math.round((rad * 180) / Math.PI) : undefined);

/** Levels passed and the next one, from the learner's banked progress. */
export function progressContext(progress: TrainingProgress): Pick<TrainingContext, "levels_passed" | "next_level" | "module_count"> {
  return {
    levels_passed: CURRICULUM.filter((m) => progress[m.id]?.passed).map((m) => clip(m.title, 120)!).slice(0, 20),
    next_level: clip(CURRICULUM.find((m) => !progress[m.id]?.passed)?.title, 120) ?? null,
    module_count: CURRICULUM.length,
  };
}

export function telemetryContext(t: MachineTelemetry, emergencyStopped: boolean): NonNullable<TrainingContext["telemetry"]> {
  return {
    speed_kmh: round(t.speed * 3.6) ?? null,
    heading_deg: deg(t.heading) ?? null,
    swing_deg: deg(t.swingAngle) ?? null,
    boom_deg: deg(t.boomAngle) ?? null,
    nearest_person_m: round(t.nearestPerson) ?? null,
    tip_over_margin: round(t.tipOverMargin, 2) ?? null,
    hydraulic_temp_c: round(t.hydraulicTemperature) ?? null,
    activity: clip(String(t.activity), 40) ?? null,
    emergency_stopped: emergencyStopped,
  };
}

function alertContext(a: Alert): TrainingAlert {
  return { kind: clip(a.kind, 40)!, severity: clip(a.severity, 20)!, title: clip(a.title, 120)!, message: clip(a.message, 300)! };
}

function eventContext(e: SimEvent): TrainingEventNote {
  return { time: clip(e.time, 20)!, text: clip(e.text, 200)!, severity: clip(e.severity, 20)! };
}

/** The full lesson context: step, validator verdicts, lesson machine and the simulator's own alerts. */
export function lessonContext(input: {
  lesson: LessonSnapshot;
  module: LessonModule;
  step: LessonStep;
  learner: LearnerSnapshot;
  progress: TrainingProgress;
  telemetry: MachineTelemetry;
  emergencyStopped: boolean;
  alerts: Alert[];
  events: SimEvent[];
}): TrainingContext {
  const { lesson, module, step, learner } = input;
  const active = lesson.phase !== "idle" && lesson.phase !== "finished";
  return {
    lesson_active: active,
    phase: lesson.phase,
    module_id: clip(module.id, 60),
    module_title: clip(module.title, 120),
    skill: clip(module.skill, 40),
    module_index: lesson.moduleIdx,
    step_id: active ? clip(step.id, 60) : undefined,
    step_instruction: active ? clip(step.brief, 400) : undefined,
    real_control: active ? clip(step.realControl, 200) : undefined,
    keys: active ? step.keys.slice(0, 6).map((k) => (k === "Shift" ? "SHIFT" : keyLabel(k))) : [],
    step_index: active ? lesson.stepIdx : undefined,
    step_count: module.steps.length,
    attempt: active ? lesson.attempt : undefined,
    last_failure_reason: active ? clip(lesson.lastReason, 300) : undefined,
    coach_line: clip(lesson.line?.text, 400),
    steps_passed: lesson.results.length,
    ...progressContext(input.progress),
    learner: {
      name: clip(learner.name.split(" ")[0], 60)!,
      level: clip(learner.skill, 30)!,
      weakest_skill: clip(learner.weakest_skill?.replace("_", " "), 40),
    },
    machine_source: "lesson_sim",
    telemetry: telemetryContext(input.telemetry, input.emergencyStopped),
    alerts: input.alerts.slice(0, 6).map(alertContext),
    recent_events: input.events.slice(0, 8).map(eventContext),
  };
}

/** Starter questions for where the trainee is. Asked through the one global assistant. */
export function lessonSuggestions(phase: LessonSnapshot["phase"], alertOpen: boolean): string[] {
  const out: string[] =
    phase === "retrying"
      ? ["What did I do wrong?", "Explain that differently", "Can you give me an example?"]
      : phase === "running" || phase === "passed"
        ? ["What should I do next?", "Why is this step important?", "What is happening right now?"]
        : phase === "levelDone"
          ? ["What does the next level teach?", "What should I practise more?", "Why does this skill matter?"]
          : ["What should I check before starting?", "Why do I need to wear the seatbelt?", "What does this lesson teach?"];
  return alertOpen ? ["Why did that warning appear?", ...out.slice(0, 2)] : out;
}
