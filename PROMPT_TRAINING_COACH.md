# Prompt: Agentic Operator Training Coach

> Paste everything below the line into Claude Code, running in this repo.

---

Build an **agentic operator training coach** inside the existing CAT Copilot 3D
digital twin. A learner types "teach me to operate this machine" and an LLM
coach runs them through a live, step-by-step lesson in the 3D simulator —
issuing one instruction at a time, watching real telemetry to decide whether
they actually did it, and adapting when they struggle.

This answers the challenge brief's **"Operator training hub: choose any creative
learning format — e-learning videos, instructor booking or simulation module."**
We are building the simulation module, with an AI instructor.

## The one rule that matters

**The LLM never decides whether a step passed. Telemetry does.**

An 8B model asked "did the learner press the accelerator?" will cheerfully say
yes. So the architecture splits hard:

| Deterministic code owns | The LLM owns |
|---|---|
| Did the step succeed? (predicate over `MachineTelemetry`) | What to teach next, and in what order |
| Timing, tolerances, retry counts | The wording of each instruction |
| Progress, scoring, persistence | Diagnosing *why* an attempt failed |
| Which key maps to which control | Deciding when to simplify, demo, or move on |

If you find yourself asking the model to assert a fact about machine state,
stop — that fact is already in the telemetry stream.

## Use the local model

Already built and present on this machine:

```
llama-server: C:/Users/mahen/llama.cpp/build/bin/Release/llama-server.exe
model:        C:/Users/mahen/llama.cpp/models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf
```

Launch it (add an `npm run llm` script for this):

```bash
"C:/Users/mahen/llama.cpp/build/bin/Release/llama-server.exe" \
  -m "C:/Users/mahen/llama.cpp/models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf" \
  -c 8192 --host 127.0.0.1 --port 8081 -ngl 99 --jinja
```

It exposes an OpenAI-compatible API at `http://127.0.0.1:8081/v1/chat/completions`.

Talk to it **only from a Next.js route handler** (`src/app/api/coach/route.ts`),
never from the browser — so the endpoint can be swapped for a hosted model later
without touching the UI.

### Two things verified on this exact machine — do not rediscover them

**1. Use a top-level `json_schema` parameter. `response_format` is silently
ignored.** On this build (llama.cpp b8076) the OpenAI-style
`response_format: { type: "json_schema", ... }` is accepted and then disregarded
— the model returns prose and your `JSON.parse` throws. `response_format:
{ type: "json_object" }` and a top-level `grammar` were also ignored in testing.
What works:

```jsonc
{
  "messages": [...],
  "max_tokens": 80,
  "temperature": 0.3,
  "json_schema": {            // <- top level, NOT inside response_format
    "type": "object",
    "additionalProperties": false,
    "required": ["tool", "say", "keys"],
    "properties": {
      "tool": { "type": "string", "enum": ["say", "advance", "remediate", "show_ghost"] },
      "say":  { "type": "string" },
      "keys": { "type": "array", "items": { "type": "string",
                "enum": ["ArrowUp","ArrowDown","ArrowLeft","ArrowRight",
                         "KeyW","KeyS","KeyA","KeyD","KeyQ","KeyE","Space","KeyR"] } }
    }
  }
}
```

Confirmed to return schema-valid JSON with only real key codes. Still validate
with Zod and keep a scripted fallback — but this is the form that works.

**2. It runs on CPU at about 10 tokens/sec. Budget accordingly.** The loader
reports `no devices with dedicated memory found`, so `-ngl 99` offloads nothing
here. Measured: **9.4 tok/s at 80 max_tokens (4.4 s), 11.2 tok/s at 160
(14.3 s)**.

That is a hard design constraint, not a tuning detail:

- Cap `max_tokens` at **80**. One or two sentences. A coaching line is not an essay.
- **Stream** the reply and render it as it arrives.
- Call the model **only at step boundaries** — after a pass, after a failure,
  when picking the next module. A 3-4 second pause there reads as the instructor
  thinking. A pause mid-step reads as broken.
- Never put the model between the learner's keypress and the ✓. The 60 Hz
  validator already owns that, which is the whole point of the split above.
- Pre-warm with a throwaway request on mount so the first real line is not
  cold-start slow.

## Cut the live feed while a lesson runs — this will bite you

`TwinStage` **auto-connects to the live stream** on mount (`useLiveLink.ts`): it
probes the hub's `/api/health` and, if the hub reports any attached source,
switches the telemetry source to `websocket`. (It used to probe the simulator
on :8100 directly; since the hub refactor the twin reads the shared
`@web/lib/stream` store, so every surface shows the same reality.)

That is right for `/twin` and wrong for training. In live mode the engine's
`stepLive()` writes position, heading and every joint angle onto EXC001 from the
socket, sixty times a second. The learner's keypresses are applied by the
`VehicleModel` and then immediately overwritten. Nothing moves, every step times
out, and the coach concludes the learner cannot drive.

**A lesson owns the machine, or it is not a lesson.**

### This part is already built — just use it

```tsx
<TwinStage liveLink={false} />
```

That is all training needs. `liveLink` defaults to `true`; passing `false`:

- skips the simulator probe entirely (`useLiveLink(mounted && active && liveLink)`)
- holds the keyboard source for as long as the stage is mounted
  (`useLocalControl` in `src/hooks/twin/useLocalControl.ts`)
- releases the lock on unmount via `releaseSourceLock()`, so `/twin` and
  `/simulation` auto-connect again afterwards

**Verified with the simulator running on :8100.** Harness at
`src/app/dev/local-control/page.tsx`: holding ArrowUp took the machine from
0.0 to **8.6 km/h** (its configured maximum) and back to 0.0 on release. On
`/twin` with the default `liveLink`, the same keypress does nothing — which is
the bug this prevents.

Keep that harness working as you build; if the arrow keys ever stop driving the
machine in training, this is the first thing to check.

Disconnect the **client link**, do not kill anything upstream. The stream is
shared and reference-counted (`acquireStream()`), and `/command`, `/owner` and
`/twin` may be open in other tabs reading it. `engine.setSource()` releases the
twin's handle cleanly via `stopLive()`; the hub carries on serving everyone else.

Show the state plainly in the coach header — `MACHINE: LOCAL CONTROL` during a
lesson, `MACHINE: LIVE FEED` outside one. A learner who cannot tell whether they
are driving will not trust the ✓ when it comes.

There is one exception worth supporting: **hazard drills**. The "working near
people" module wants a real worker walking at the machine. Get that from the
director hazards on the local engine (`forceWorkerApproach()`), not by
reconnecting the socket — the learner still needs to be the one driving.

## What "agentic" means here

The coach is a loop, not a chatbot:

1. **Perceive** — it receives a compact telemetry digest each step (speed,
   heading, boom/stick/bucket angles, activity, nearest worker, tip-over margin)
   plus the last few safety events.
2. **Plan** — from the learner's skill profile it picks the next module and
   decomposes it into steps.
3. **Act** — it calls tools that change the simulator, not just text.
4. **Adapt** — on repeated failure it decomposes the step further, or runs the
   expert ghost so the learner can watch it done properly.

Give it these tools (JSON-schema constrained, executed by your own code):

```ts
say(text)                          // one short instruction or a correction
start_level(levelId)               // refused by code if `requires` is unmet
set_drill(drillId)                 // move within the current level's drills
add_remedial_drill(afterId, spec)  // they struggled; insert a simpler rung
begin_check()                      // coaching goes quiet; the clock starts
remediate(reason)                  // diagnose a failure in one line
show_ghost(runId)                  // play the expert run as a demo
set_camera(mode)                   // "driver" for arm work, "follow" for travel
spawn_hazard(scenario)             // forceWorkerApproach() etc. for level 5
reset_machine()
praise(fact)                       // one line naming a real telemetry fact

// Note there is no `pass_level`. Only the validator can pass a check, and only
// stored results can unlock the next level.
```

## Levels, not a manual

This is the part that matters most. It is **not** a document with a simulator
next to it, and it is not one long lesson. It is a **ladder of levels the
learner climbs**, the way a game teaches: one competency per level, earned by
doing it, and the next level does not open until this one is passed.

```
  LEVEL 1  Move the machine          * * *   passed
  LEVEL 2  Steer and place           * *     passed
  LEVEL 3  The house and the arm     >       in progress
  LEVEL 4  A full dig cycle          locked
  LEVEL 5  People on site            locked
  LEVEL 6  Working on a slope        locked
```

### Every level has the same three beats

1. **Brief** - two lines. What this level teaches and why it matters on a real
   site. Never more.
2. **Drills** - two to five guided steps. The coach talks, hints when they
   stall, unlimited retries, no score. This is where learning happens.
3. **Check** - the same skill once more, **with the coaching turned off** and a
   time or tolerance to beat. Passing the check is what unlocks the next level.

That split is the whole design. Drills with hints prove nothing; a check with no
hints proves they can actually do it. A learner who only succeeds while being
told each keystroke has not learned to operate the machine.

```ts
interface Level {
  id: string;
  index: number;                 // 1-based; the ladder is ordered
  title: string;                 // "Move the machine"
  why: string;                   // one line of site-real justification
  drills: LessonStep[];          // coached, retryable, unscored
  check: LessonCheck;            // uncoached, timed, gates the next level
  /** Levels that must be passed first. Usually just the previous one. */
  requires: string[];
}

interface LessonCheck {
  brief: string;
  success: (t: MachineTelemetry, ctx: StepContext) => boolean;
  /** Beat this for three stars; it is the level's par time. */
  targetMs: number;
  timeoutMs: number;
  /** Any of these during the check costs a star. */
  penalties: { when: (t: MachineTelemetry, ctx: StepContext) => boolean; label: string }[];
}
```

`LessonStep` keeps the shape defined above - `brief`, `realControl`, `keys`,
`success`, `holdMs`, `timeoutMs`, `hints`.

### The ladder

| # | Level | Drills | Check passes when |
|---|---|---|---|
| 1 | **Move the machine** | hold up-arrow to travel; release and let it roll out; reverse | travel 15 m forward and stop inside a 2 m box |
| 2 | **Steer and place** | turn on the spot; turn while travelling | park on a marker within 1.5 m and 10 deg of a heading |
| 3 | **The house and the arm** | slew with shift+arrows; boom, stick, bucket | reach a called-out pose (boom 40, stick -30, bucket curled) and hold it 2 s |
| 4 | **A full dig cycle** | dig, curl, lift, slew, dump, return | three clean cycles, payload over 1500 kg each, under par time |
| 5 | **People on site** | read the bubble; stop for a worker; e-stop drill | worker walks in via `forceWorkerApproach()`, machine stopped before the red ring, zero red-zone seconds |
| 6 | **Working on a slope** | approach a grade; watch `tipOverMargin`; retract before slewing | a loaded slew on the pit ramp with margin never below 1.5 |

Levels 5 and 6 are the point of the product. Everything before them exists to
give the learner enough control to be tested on safety.

### Progression rules

- **Sequential and gated.** `requires` is enforced by code, never by the LLM. A
  locked level is not selectable, and the ladder states plainly why it is locked.
- **Stars, not percentages.** Three stars = passed inside `targetMs` with no
  penalties. Two = passed. One = passed after three or more attempts. Stars drive
  replay; one star still unlocks the next level.
- **Never hard-block a learner.** After three failed checks the coach offers
  `show_ghost` - the expert run played in the scene - then lets them try again.
  Frustration is the only failure that loses a learner for good.
- **Persist progress** in `localStorage` under one versioned key
  (`cat.training.v1`): levels passed, stars, attempts, best times. Re-entering
  `/training` resumes at the first unpassed level.
- **Replay is always allowed** on a passed level, to chase stars.

### The level-complete moment

Make this feel like something. On a check pass: stop the clock, freeze input,
and show stars earned, time against par, what specifically improved, and one
primary button - **Next level**. The coach writes a single line of praise that
names the actual thing they did well, taken from telemetry rather than generic
filler.

Level 4 is the natural home for the ghost comparison: their cycle time against
the expert's 19 s and the novice's 26 s from `data/runs/`.

### What the LLM does and does not do here

| The LLM | Code |
|---|---|
| Rewrites a drill's wording for someone struggling | Decides the check passed |
| Chooses whether to add a remedial drill before the check | Enforces `requires` and unlocking |
| Writes the praise line, naming a real telemetry fact | Computes stars, time, penalties |
| Decides when to offer the ghost | Plays it |

The model may **suggest** moving on. It may never **grant** a level. Unlocking is
a pure function of stored results, so a learner can always see exactly why
something is locked, and a hallucinating 8B model can never hand out a
qualification.

### Control mapping - do not invent keys

Lesson text names the real control; the HUD shows the key.

| Real control | Sim keys |
|---|---|
| travel pedals | `ArrowUp` / `ArrowDown` |
| track levers | `ArrowLeft` / `ArrowRight` |
| swing joystick | `Shift` + `ArrowLeft/Right` |
| right joystick fore/aft (boom) | `W` / `S` |
| left joystick fore/aft (stick) | `A` / `D` |
| right joystick left/right (bucket) | `Q` / `E` |
| cab e-stop | `Space` |
| sim only | `R` resets the machine |

## Where it plugs in

Everything below already exists. Extend it; don't build a parallel twin.

- **`src/app/(product)/training/page.tsx`** → `src/components/training/training-hub.tsx`
  (310 lines, module cards + progress rings). Add the coach as a new mode here.
- **`src/components/twin/TwinExperience.tsx`** exports `<TwinStage active dense />`,
  which fills any positioned parent. Mount it inside the training hub.
- **`src/lib/twin/controls.ts`** — the `KEYS` map and `activeKeys()` tell you what
  the learner is pressing right now.
- **`src/store/twinStore.ts`** — `useTwinStore.getState().engine` gives live,
  mutated-in-place `MachineTelemetry`. Read it in a `useFrame`-driven validator
  at 60 Hz; do **not** subscribe React to it per frame.
- **`src/lib/twin/simulation.ts`** — `SimulationEngine`, `resetMachine()`,
  `startReplay()`, the director hazards (`forceWorkerApproach()` etc.).
- **`data/runs/expert_run.json` / `novice_run.json`** — the same trenching task
  done by an expert (9 cycles, 19 s each) and a novice (6 cycles, 26 s). Already
  converted to twin units in `src/data/generated/replays.json` and loadable via
  `getRun()` in `src/lib/data/dataset.ts`. This is your ghost comparison.
- **`fixtures/training_profiles.json`** — per-operator skill vector (`digging`,
  `swinging`, `slope_work`, `safety`, `fuel_efficiency`), `weakest_skill` and
  `recommended_next_module`. Seed the curriculum from this.
- **`src/lib/data/dataset.ts`** — `dataset.tasks.bySkill` has the real gap:
  novices overrun estimates by **1.81×**, experts by **1.15×**. Use it to make
  the stakes concrete ("closing this gap is worth ~40 minutes a shift").

## Build order

1. ~~Source control~~ — **done**. Mount the twin as
   `<TwinStage liveLink={false} />` and the learner keeps the keyboard. Confirm
   it still holds once the hub mounts the stage: arrow keys must drive EXC001
   with the simulator running.
2. `npm run llm` script + `/api/coach` route with schema-constrained output.
   Prove it round-trips a tool call before touching the UI.
3. `src/lib/training/levels.ts` — the six levels, their drills and checks, with
   success predicates as pure functions. Unit-test the predicates against
   synthetic telemetry; no LLM, no React, no browser.
4. `src/lib/training/progress.ts` — passed levels, stars, attempts, best times;
   `isUnlocked(levelId, progress)` as a pure function; `localStorage` under
   `cat.training.v1` with a version check so a schema change cannot crash a
   returning learner. Test the unlock rules directly.
5. `src/lib/training/validator.ts` — the 60 Hz watcher: hold timers, timeouts,
   penalty detection, check scoring. Also pure.
6. **Build level 1 end to end before writing level 2.** Drills, check, pass,
   stars, unlock, and the Next-level hand-off. One level that genuinely works
   beats six that half-work, and the shape of level 1 will change your mind
   about the others.
7. `useTrainingCoach()` hook — wires validator events to the LLM and applies the
   returned tool calls to the twin.
8. Level-ladder UI in the training hub: the ladder with locked/unlocked/passed
   and star counts, the instruction card, the live key prompt (reuse the
   `KeyHints` styling from `CommandCenter.tsx`), and the level-complete panel.
9. Levels 2–6, then the ghost comparison on level 4.

## Non-negotiables

- **It must work with the simulator down, and correctly with it up.** Training
  runs on local keyboard control either way. With `:8100` down the twin already
  falls back; with it up you must explicitly disconnect, per the section above.
  Test both — the second one is the case that breaks.
- **It must work with the LLM down.** If `:8081` doesn't answer, fall back to the
  scripted `brief` text for each step. The lesson still runs; it just stops
  adapting. Show an honest badge — `COACH: SCRIPTED` vs `COACH: LIVE`. Given the
  10 tok/s measurement, treat scripted text as the *default* for anything
  time-critical and let the model handle the between-step adaptation.
- Don't regress the existing `/twin` or `/simulation` routes.
- Match the house style: `ink-*` / `cat-500` / `status-*` tokens, `panel` and
  `panel-raised` utilities from `globals.css`, tabular mono for numbers.
- Keep the existing React-Compiler ESLint exemption scoped to `src/**/twin/**`;
  new training code should pass the default rules.
- Verify in a real browser before claiming it works.

## Done means

A learner opens `/training` and sees a ladder of six levels with one unlocked.
They start level 1, are coached through its drills one validated step at a time,
then take the check with the hints switched off. Passing it earns stars, unlocks
level 2, and hands them straight into it.

By level 5 they are stopping the machine for a worker who walks into the bubble;
by level 6 they are watching the tip-over margin on a grade. They can close the
tab and come back to where they left off.

The coach adapts when they struggle and shows them the expert ghost when words
are not enough — but every level they hold was earned against telemetry, not
granted by a language model.
