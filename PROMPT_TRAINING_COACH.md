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

`TwinStage` **auto-connects to the simulator** on mount (`useLiveLink.ts`): it
probes `http://localhost:8100/health` and, if anything answers, switches the
telemetry source to `websocket`.

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

Disconnect the **client link**, do not kill the Python process. `/command`,
`/owner` and `/twin` may be open in other tabs reading the same simulator, and a
training session has no business stopping a shared service. `engine.setSource()`
already tears the socket down cleanly via `stopLive()`.

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
start_lesson(moduleId)
set_step(stepId)
advance()                          // only callable after the validator passes
remediate(reason, simplerStepId)   // it struggled; back off
show_ghost(runId)                  // play expert_run.json as a demo
set_camera(mode)                   // "driver" for pedal work, "follow" for travel
spawn_hazard(scenario)             // fire a simulator scenario for hazard drills
reset_machine()
finish(score, weakestSkill)
```

## The step-by-step mechanic

This is the core interaction. Example first lesson, exactly as the learner sees it:

```
COACH   Lesson 1 of 4 — Travel control.
        On a real 320 you'd push the travel pedals. Here, hold the UP ARROW.
        Get her moving and hold about 3 km/h.

        [ ↑ ]  hold to travel                      waiting…

  →  learner holds ArrowUp, telemetry.speed climbs past 0.8 m/s

COACH   ✓ That's it. Feel how long she takes to get going — forty tonnes
        doesn't hurry. Now ease off and let her roll to a stop.
```

Each step is:

```ts
interface LessonStep {
  id: string;
  /** What the coach says. The LLM may rewrite this for the learner's level. */
  brief: string;
  /** The real-machine control, for the lesson text. */
  realControl: string;          // "travel pedals"
  /** The sim key(s) shown in the HUD. */
  keys: string[];               // ["ArrowUp"]
  /** Deterministic pass condition over live telemetry. */
  success: (t: MachineTelemetry, ctx: StepContext) => boolean;
  /** Must hold for this long, so a twitch doesn't count. */
  holdMs: number;
  /** Fail after this, then ask the LLM to remediate. */
  timeoutMs: number;
  /** Named failure modes, given to the LLM as diagnosis hints. */
  hints: { when: (t, ctx) => boolean; reason: string }[];
}
```

Build the curriculum from the controls that already exist in
`src/lib/twin/controls.ts` — **do not invent keys**:

| Module | Real control | Sim keys |
|---|---|---|
| Travel | travel pedals | `ArrowUp` / `ArrowDown` |
| Steering | track levers | `ArrowLeft` / `ArrowRight` |
| Slew | swing joystick | `Shift` + `ArrowLeft/Right` |
| Boom | right joystick fore/aft | `W` / `S` |
| Stick | left joystick fore/aft | `A` / `D` |
| Bucket | right joystick left/right | `Q` / `E` |
| Emergency stop | cab e-stop | `Space` |

Suggested modules: **Travel control → Slew and arm → A full dig cycle →
Working near people** (spawn `worker_behind`, learner must stop before the red
bubble) → **Slope awareness** (watch `tipOverMargin`).

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
3. `src/lib/training/curriculum.ts` — steps and their success predicates, pure
   and unit-testable. Test predicates against synthetic telemetry, no LLM.
4. `src/lib/training/validator.ts` — the 60 Hz watcher: hold timers, timeouts,
   failure-mode detection. Also pure.
5. `useTrainingCoach()` hook — wires validator events to the LLM and applies the
   returned tool calls to the twin.
6. Coach UI inside the training hub: instruction card, live key prompt (reuse
   the `KeyHints` styling from `CommandCenter.tsx`), progress, ghost overlay.
7. Wire the ghost comparison and the end-of-lesson score.

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

A learner opens `/training`, clicks **Start guided lesson**, and is taught to
drive the excavator one validated step at a time by a local LLM that watches
what they actually do — adapting when they struggle, showing them the expert
ghost when words aren't enough, and finishing with a score against their
recorded skill profile.
