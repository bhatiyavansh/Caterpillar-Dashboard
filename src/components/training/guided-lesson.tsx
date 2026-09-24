"use client";

/**
 * Guided lesson: learn the excavator one validated step at a time.
 *
 * The 3D twin owns the left of the screen and the keyboard (`liveLink={false}`
 * holds local control, so a running simulator cannot overwrite the learner's
 * input). The coach panel on the right shows one instruction, the live reading
 * the step is judged on, and a hold bar that fills while the learner is doing
 * it right. The ✓ comes from telemetry; the words come from the local model.
 *
 * Under the instruction the trainee can talk to the instructor: the one global
 * site assistant, routed to its training specialist, which is told the lesson
 * step, the validator's verdict and the lesson machine's readings with every
 * question. It explains and teaches; it never decides whether a step passed.
 */
import * as React from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  BookMarked,
  Check,
  ChevronRight,
  Cpu,
  Keyboard,
  ListOrdered,
  LoaderCircle,
  Lock,
  MessageSquare,
  RotateCcw,
  SkipForward,
  Square,
  Star,
  Trophy,
} from "lucide-react";
import { CURRICULUM, keyLabel } from "@/lib/training/curriculum";
import {
  commitProgress,
  firstUnpassedIndex,
  getProgressSnapshot,
  getServerProgressSnapshot,
  isUnlocked,
  levelsPassed,
  lockReason,
  recordLevel,
  starsFor,
  subscribeProgress,
  totalStars,
  type TrainingProgress,
} from "@/lib/training/progress";
import { LEARNERS, useTrainingCoach, type LearnerProfile } from "@/lib/training/use-training-coach";
import { lessonContext, lessonSuggestions } from "@/lib/training/assistant-context";
import { useTwinStore } from "@/store/twinStore";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { useAssistantScope } from "@/components/assistant/assistant-provider";
import { cn } from "@/lib/utils";

// The twin is WebGL-only; never render it on the server.
const TwinStage = dynamic(() => import("@/components/twin/TwinExperience").then((m) => m.TwinStage), { ssr: false });

/* ------------------------------------------------------------ key pad */

function usePressedKeys() {
  const [pressed, setPressed] = React.useState<Set<string>>(() => new Set());
  React.useEffect(() => {
    const norm = (code: string) => (code.startsWith("Shift") ? "Shift" : code);
    const down = (e: KeyboardEvent) => setPressed((p) => (p.has(norm(e.code)) ? p : new Set(p).add(norm(e.code))));
    const up = (e: KeyboardEvent) =>
      setPressed((p) => {
        const n = new Set(p);
        n.delete(norm(e.code));
        return n;
      });
    const clear = () => setPressed(new Set());
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return pressed;
}

function KeyCap({ code, pressed, wanted, demo, wide }: { code: string; pressed: boolean; wanted: boolean; demo: boolean; wide?: boolean }) {
  return (
    <kbd
      className={cn(
        "grid h-14 place-items-center rounded-lg border-2 border-b-4 font-mono text-xl font-bold transition-all duration-75",
        wide ? "w-28 text-sm" : "w-14",
        pressed
          ? "translate-y-0.5 border-cat-500 border-b-2 bg-cat-500 text-ink-950"
          : wanted
            ? cn("border-cat-500 bg-ink-900 text-cat-400", demo && "animate-pulse")
            : "border-white/15 bg-ink-900 text-zinc-600",
      )}
      aria-label={`${keyLabel(code)} key${pressed ? ", pressed" : ""}`}
    >
      {keyLabel(code)}
    </kbd>
  );
}

/** Arrow cluster plus the modifiers and arm keys, lit for the current step. */
function KeyPad({ wanted, demo }: { wanted: string[]; demo: boolean }) {
  const pressed = usePressedKeys();
  const cap = (code: string, wide?: boolean) => (
    <KeyCap code={code} pressed={pressed.has(code)} wanted={wanted.includes(code)} demo={demo} wide={wide} />
  );
  return (
    <div className="flex items-end justify-center gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">{["KeyQ", "KeyW", "KeyE"].map((c) => <React.Fragment key={c}>{cap(c)}</React.Fragment>)}</div>
        <div className="flex gap-2">{["KeyA", "KeyS", "KeyD"].map((c) => <React.Fragment key={c}>{cap(c)}</React.Fragment>)}</div>
      </div>
      <div className="flex flex-col items-center gap-2">
        {cap("Shift", true)}
        {cap("Space", true)}
      </div>
      <div className="flex flex-col items-center gap-2">
        {cap("ArrowUp")}
        <div className="flex gap-2">
          {cap("ArrowLeft")}
          {cap("ArrowDown")}
          {cap("ArrowRight")}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------- intro page */

/** Three slots, filled to `n`. */
function Stars({ n, dim }: { n: number; dim?: boolean }) {
  return (
    <span className="flex gap-0.5" aria-label={`${n} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <Star
          key={i}
          className={cn(
            "size-3.5",
            i <= n ? "fill-cat-500 text-cat-500" : dim ? "text-white/10" : "text-white/20",
          )}
          aria-hidden
        />
      ))}
    </span>
  );
}

/**
 * The ladder.
 *
 * One rung per level, showing only what the learner needs to decide what to do
 * next: what it teaches, whether it is open, and how well they did. The steps
 * inside a level are deliberately *not* listed — laying all fourteen out at
 * once turns a course into a manual, and the whole point is that each step
 * arrives when it is time to do it.
 */
function Ladder({
  learner,
  onLearner,
  progress,
  onStart,
  coachLive,
}: {
  learner: LearnerProfile;
  onLearner: (l: LearnerProfile) => void;
  progress: TrainingProgress;
  onStart: (moduleIdx: number) => void;
  coachLive: boolean | null;
}) {
  const resumeAt = firstUnpassedIndex(progress);
  const passed = levelsPassed(progress);
  const resumeLevel = CURRICULUM[resumeAt];

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-6">
      <div>
        <p className="label-xs">
          Level {Math.min(resumeAt + 1, CURRICULUM.length)} of {CURRICULUM.length}
          {passed > 0 ? ` · ${totalStars(progress)} stars` : null}
        </p>
        <h2 className="mt-1 text-2xl font-bold text-zinc-50">Learn the excavator</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
          One level at a time. Each step names the real control and only ticks when the machine&apos;s
          sensors confirm you did it. Pass a level to open the next.
        </p>
      </div>

      <label className="block">
        <span className="label-xs">Learner</span>
        <select
          value={learner.operator_id}
          onChange={(e) => onLearner(LEARNERS.find((l) => l.operator_id === e.target.value) ?? learner)}
          className="mt-1.5 h-11 w-full rounded-lg border border-white/12 bg-ink-850 px-3 text-sm text-zinc-100"
        >
          {LEARNERS.map((l) => (
            <option key={l.operator_id} value={l.operator_id}>
              {l.name} · {l.skill} · weakest: {l.weakest_skill.replace("_", " ")}
            </option>
          ))}
        </select>
      </label>

      <ol className="space-y-2">
        {CURRICULUM.map((m, i) => {
          const record = progress[m.id];
          const unlocked = isUnlocked(m.id, progress);
          const current = i === resumeAt;
          const locked = !unlocked;

          return (
            <li key={m.id}>
              <button
                type="button"
                disabled={locked}
                onClick={() => onStart(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition",
                  locked && "cursor-not-allowed border-white/6 bg-ink-900/40",
                  current && "border-cat-500/60 bg-cat-500/10",
                  !locked && !current && "border-white/8 bg-ink-900 hover:border-white/20",
                )}
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full font-mono text-xs font-bold",
                    record?.passed && "bg-status-ok/15 text-status-ok",
                    current && !record?.passed && "bg-cat-500 text-ink-950",
                    locked && "bg-white/5 text-zinc-600",
                    !locked && !current && !record?.passed && "bg-white/8 text-zinc-300",
                  )}
                >
                  {record?.passed ? <Check className="size-4" aria-hidden /> : locked ? <Lock className="size-3.5" aria-hidden /> : i + 1}
                </span>

                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm font-semibold", locked ? "text-zinc-500" : "text-zinc-100")}>
                    {m.title}
                  </span>
                  <span className="block truncate text-xs text-zinc-500">
                    {locked
                      ? lockReason(m.id, progress)
                      : record?.passed
                        ? `Passed · ${m.steps.length} steps · best ${record.score}`
                        : `${m.steps.length} steps · builds ${m.skill.replace("_", " ")}`}
                  </span>
                </span>

                {record?.passed ? <Stars n={record.stars} /> : null}
                {current && !record?.passed ? (
                  <ChevronRight className="size-4 shrink-0 text-cat-500" aria-hidden />
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-auto space-y-2">
        <p className="flex items-center gap-2 text-xs text-zinc-500">
          <Cpu className="size-3.5" aria-hidden />
          {coachLive === null
            ? "Checking the local coach model…"
            : coachLive
              ? "Coach: live, local Llama 3.1 8B via llama.cpp, grounded in the site manuals."
              : "Coach: scripted. Start the local model with `npm run llm` for adaptive coaching."}
        </p>
        <button
          onClick={() => onStart(resumeAt)}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-cat-500 text-sm font-bold text-ink-950 transition hover:bg-cat-400"
        >
          {passed > 0 ? "Continue" : "Start"} level {resumeAt + 1} · {resumeLevel.title}
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * The moment a level is passed.
 *
 * Deliberately a full stop: the clock is off, the machine is idle, and there is
 * one obvious thing to do next. Running straight into the following level would
 * rob the learner of the only feedback that tells them they are getting better.
 */
function LevelComplete({
  title,
  index,
  stars,
  score,
  seconds,
  steps,
  nextTitle,
  onNext,
  onReplay,
  onLadder,
}: {
  title: string;
  index: number;
  stars: number;
  score: number;
  seconds: number;
  steps: number;
  nextTitle: string;
  onNext: () => void;
  onReplay: () => void;
  onLadder: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-6">
      <div>
        <p className="label-xs">Level {index + 1} complete</p>
        <h2 className="mt-1 text-2xl font-bold text-zinc-50">{title}</h2>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-cat-500/40 bg-cat-500/10 p-4">
        <Stars n={stars} />
        <span className="ml-auto text-right">
          <span className="block font-mono text-3xl font-bold leading-none tabular-nums text-cat-400">
            {score}
          </span>
          <span className="mt-1 block text-[11px] text-zinc-500">
            {steps} steps · {seconds.toFixed(1)}s
          </span>
        </span>
      </div>

      <div className="mt-auto space-y-2">
        {nextTitle ? (
          <button
            onClick={onNext}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-cat-500 text-sm font-bold text-ink-950 transition hover:bg-cat-400"
          >
            Next level · {nextTitle}
            <ChevronRight className="size-4" aria-hidden />
          </button>
        ) : null}
        <div className="flex gap-2">
          <button
            onClick={onReplay}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 text-sm font-semibold text-zinc-100 transition hover:bg-white/5"
          >
            <RotateCcw className="size-4" aria-hidden /> Replay
          </button>
          <button
            onClick={onLadder}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-white/15 text-sm font-semibold text-zinc-100 transition hover:bg-white/5"
          >
            All levels
          </button>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- main UI */

/**
 * `controls.ts` ignores keys while a button has focus (so Space presses the
 * button instead of the e-stop). After clicking a lesson control, hand the
 * keyboard back to the machine.
 */
function releaseFocus() {
  const el = document.activeElement as HTMLElement | null;
  el?.blur();
}

export function GuidedLesson({ onExit }: { onExit?: () => void }) {
  const [learner, setLearner] = React.useState<LearnerProfile>(
    () => LEARNERS.find((l) => l.skill === "novice") ?? LEARNERS[0],
  );
  const coach = useTrainingCoach(learner);
  const { state, module, step } = coach;

  // localStorage is an external store, so it is read through the store API
  // rather than an effect: no cascading render, and SSR gets a defined snapshot.
  const progress = React.useSyncExternalStore(
    subscribeProgress,
    getProgressSnapshot,
    getServerProgressSnapshot,
  );

  const running =
    state.phase !== "idle" && state.phase !== "finished" && state.phase !== "levelDone";

  // Tell the global assistant where the trainee is. Read only when a question is sent, so the
  // 60 Hz lesson never re-renders anything on the assistant's account.
  const alertOpen = useTwinStore((s) => s.snapshot.alerts.length > 0);
  const lessonRef = React.useRef({ state, module, step, learner, progress });
  React.useLayoutEffect(() => {
    lessonRef.current = { state, module, step, learner, progress };
  });
  useAssistantScope({
    surface: "training",
    label: running ? `Instructor · ${module.title}` : "Training instructor",
    suggestions: lessonSuggestions(state.phase, alertOpen),
    getContext: () => {
      const l = lessonRef.current;
      const { engine, snapshot } = useTwinStore.getState();
      return {
        training: lessonContext({
          lesson: l.state,
          module: l.module,
          step: l.step,
          learner: { name: l.learner.name, skill: l.learner.skill, weakest_skill: l.learner.weakest_skill },
          progress: l.progress,
          telemetry: engine.primary,
          emergencyStopped: engine.emergencyStopped,
          alerts: snapshot.alerts,
          events: snapshot.events,
        }),
      };
    },
  });
  const [pane, setPane] = React.useState<"ask" | "log">("ask");

  // Bank the level the moment it is passed, so closing the tab keeps it.
  const bankedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (state.phase !== "levelDone" && state.phase !== "finished") {
      bankedFor.current = null;
      return;
    }
    if (bankedFor.current === module.id) return;
    bankedFor.current = module.id;

    const stars = starsFor(coach.levelScore, coach.levelAttempts, module.steps.length);
    // Writing to the external store from an effect is the supported direction:
    // React state is not being set, storage is being updated.
    commitProgress(
      recordLevel(getProgressSnapshot(), module.id, {
        stars,
        attempts: coach.levelAttempts,
        score: coach.levelScore,
        ms: coach.levelMs,
      }),
    );
  }, [state.phase, module.id, module.steps.length, coach.levelScore, coach.levelAttempts, coach.levelMs]);
  const skillBefore = learner.skills[module.skill];

  return (
    <div className="flex h-full min-h-0 flex-col bg-ink-950 lg:flex-row">
      {/* Simulator */}
      <div className="relative min-h-[360px] flex-1">
        <TwinStage liveLink={false} hud={false} physics={false} />
        {running ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center">
            <div className="rounded-xl border border-white/10 bg-ink-950/90 px-5 py-4 shadow-2xl">
              <KeyPad wanted={step.keys} demo={state.demo} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Coach */}
      <aside className="flex w-full shrink-0 flex-col border-t border-white/10 bg-ink-900 lg:w-[420px] lg:border-l lg:border-t-0" aria-label="Lesson coach">
        <header className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          {onExit ? (
            <button onClick={onExit} aria-label="Leave lesson" className="grid size-9 place-items-center rounded-md text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
              <ArrowLeft className="size-4" />
            </button>
          ) : null}
          <p className="whitespace-nowrap text-sm font-bold text-zinc-100">Training coach</p>
          <span className="ml-auto whitespace-nowrap rounded bg-status-ok/15 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-status-ok">
            MACHINE: LOCAL CONTROL
          </span>
          <span
            className={cn(
              "whitespace-nowrap rounded px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider",
              state.coachLive ? "bg-cat-500/15 text-cat-400" : "bg-white/8 text-zinc-400",
            )}
          >
            COACH: {state.coachLive ? "LIVE" : "SCRIPTED"}
          </span>
        </header>

        {state.phase === "idle" ? (
          <Ladder
            learner={learner}
            onLearner={setLearner}
            progress={progress}
            coachLive={state.coachLive}
            onStart={(moduleIdx) => {
              releaseFocus();
              coach.start(moduleIdx);
            }}
          />
        ) : state.phase === "levelDone" ? (
          <LevelComplete
            title={module.title}
            index={state.moduleIdx}
            stars={starsFor(coach.levelScore, coach.levelAttempts, module.steps.length)}
            score={coach.levelScore}
            seconds={coach.levelMs / 1000}
            steps={module.steps.length}
            nextTitle={CURRICULUM[state.moduleIdx + 1]?.title ?? ""}
            onNext={() => {
              releaseFocus();
              coach.nextLevel();
            }}
            onReplay={() => {
              releaseFocus();
              coach.replayLevel();
            }}
            onLadder={() => {
              releaseFocus();
              coach.stop();
            }}
          />
        ) : state.phase === "finished" ? (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-6">
            <Trophy className="size-10 text-cat-500" aria-hidden />
            <h2 className="text-2xl font-bold text-zinc-50">Lesson complete</h2>
            <p className="font-mono text-5xl font-bold text-cat-400 tabular-nums">{coach.score}</p>
            <p className="text-sm text-zinc-400">
              Across {state.results.length} steps. {learner.name.split(" ")[0]}&apos;s recorded {learner.weakest_skill.replace("_", " ")} score
              was {learner.skills[learner.weakest_skill as keyof typeof learner.skills]}.
            </p>
            <ul className="divide-y divide-white/5 rounded-lg border border-white/8">
              {state.results.map((r) => (
                <li key={r.stepId} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="text-zinc-300">{r.stepId}</span>
                  <span className="font-mono text-zinc-500">
                    {(r.ms / 1000).toFixed(1)}s · {r.attempts} {r.attempts === 1 ? "try" : "tries"} ·{" "}
                    <span className="text-zinc-100">{r.score}</span>
                  </span>
                </li>
              ))}
            </ul>
            <button onClick={() => {
              releaseFocus();
              coach.start();
            }} className="flex h-11 items-center justify-center gap-2 rounded-lg border border-white/15 text-sm font-semibold text-zinc-100 hover:bg-white/5">
              <RotateCcw className="size-4" aria-hidden /> Run it again
            </button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Stepper */}
            <div className="border-b border-white/10 px-4 py-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-300">
                  {state.moduleIdx + 1}/{CURRICULUM.length} · {module.title}
                </span>
                <span className="font-mono text-zinc-500">
                  step {state.stepIdx + 1}/{module.steps.length}
                </span>
              </div>
              <div className="mt-2 flex gap-1" aria-hidden>
                {CURRICULUM.flatMap((m, mi) =>
                  m.steps.map((s, si) => {
                    const done = state.results.some((r) => r.stepId === s.id);
                    const current = mi === state.moduleIdx && si === state.stepIdx;
                    return <span key={s.id} className={cn("h-1.5 flex-1 rounded-full", done ? "bg-status-ok" : current ? "bg-cat-500" : "bg-white/10")} />;
                  }),
                )}
              </div>
            </div>

            {/* Instruction */}
            <div className="space-y-4 p-4">
              <div
                className={cn(
                  "rounded-lg border p-4",
                  state.phase === "passed" ? "border-status-ok/40 bg-status-ok/10" : state.phase === "retrying" ? "border-status-warn/40 bg-status-warn/10" : "border-white/10 bg-ink-850",
                )}
                aria-live="polite"
              >
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {state.phase === "passed" ? <Check className="size-4 text-status-ok" aria-hidden /> : <Keyboard className="size-4" aria-hidden />}
                  {step.realControl}
                  {state.attempt > 1 ? <span className="text-status-warn">attempt {state.attempt}</span> : null}
                  {state.line?.thinking ? <LoaderCircle className="ml-auto size-3.5 animate-spin text-cat-500" aria-label="Coach is thinking" /> : null}
                  {state.line && !state.line.thinking ? (
                    <span className={cn("ml-auto font-mono text-[10px]", state.line.source === "live" ? "text-cat-400" : "text-zinc-600")}>
                      {state.line.source === "live" ? "llama" : "script"}
                    </span>
                  ) : null}
                </div>
                <p className="text-[17px] leading-snug text-zinc-50">{state.line?.text ?? step.brief}</p>
                {state.line?.citation ? (
                  <p className="mt-2 flex items-start gap-1.5 text-[11px] text-zinc-500">
                    <BookMarked className="mt-0.5 size-3 shrink-0" aria-hidden /> {state.line.citation.citation}
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border border-white/10 bg-ink-850 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="label-xs">{step.gauge.label}</span>
                  <span className="font-mono text-xs text-zinc-500">target {step.gauge.target}</span>
                </div>
                <p className="mt-1 font-mono text-3xl font-bold text-zinc-50 tabular-nums">{state.gauge || "—"}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Hold progress" aria-valuenow={Math.round(state.hold * 100)}>
                  <div className={cn("h-full rounded-full transition-[width] duration-100", state.phase === "passed" ? "bg-status-ok" : "bg-cat-500")} style={{ width: `${state.hold * 100}%` }} />
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">
                  {state.phase === "passed" ? "Confirmed by sensors." : state.hold > 0 ? "Hold it…" : `${Math.max(0, Math.ceil((step.timeoutMs - state.elapsed) / 1000))}s left on this attempt`}
                </p>
              </div>

              {skillBefore !== undefined ? (
                <p className="text-[11px] text-zinc-500">
                  Trains <span className="text-zinc-300">{module.skill.replace("_", " ")}</span>. {learner.name.split(" ")[0]}&apos;s recorded score: {skillBefore}/100.
                </p>
              ) : null}
            </div>

            {/* Ask the instructor (the global assistant) / the coach's transcript */}
            <div className="flex min-h-0 flex-1 flex-col border-t border-white/10">
              <div className="flex shrink-0 gap-1 px-3 pt-2" role="tablist" aria-label="Instructor">
                {([
                  { id: "ask", label: "Ask the instructor", icon: MessageSquare },
                  { id: "log", label: `Coach log (${Math.max(0, state.history.length - 1)})`, icon: ListOrdered },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={pane === id}
                    onClick={() => {
                      setPane(id);
                      releaseFocus();
                    }}
                    className={cn(
                      "flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold transition-colors",
                      pane === id ? "bg-white/10 text-zinc-100" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>
              {pane === "ask" ? (
                <AssistantPanel variant="inline" surface="training" releaseFocusOnSend persistentSuggestions className="m-3 mt-2 min-h-[220px] flex-1" />
              ) : (
                <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-label="Coach transcript">
                  {[...state.history].reverse().slice(1).map((h) => (
                    <li key={h.id} className="text-xs leading-relaxed text-zinc-500">
                      {h.text}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="flex gap-2 border-t border-white/10 p-3">
              <button onClick={() => {
                releaseFocus();
                coach.skip();
              }} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/12 text-xs font-semibold text-zinc-300 hover:bg-white/5">
                <SkipForward className="size-3.5" aria-hidden /> Skip step
              </button>
              <button onClick={coach.stop} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/12 text-xs font-semibold text-zinc-300 hover:bg-white/5">
                <Square className="size-3.5" aria-hidden /> End lesson
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
