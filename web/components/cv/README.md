# Webcam CV components (Person C → Person D)

Two self-contained React components that run entirely in the browser. Drop them
anywhere on `/cab`; they need no backend of their own.

## Install

```bash
npm install @mediapipe/tasks-vision
```

The WASM bundle and the two models load from jsDelivr / Google's model CDN on
first use and are cached by the browser afterwards.

## Use

```tsx
import { PersonDetector, FatigueDetector } from "@/components/cv";

<PersonDetector
  machineId="EXC001"
  showVideo
  onEvent={(e) => socket.send(JSON.stringify(e))}   // → /ws/ingest
/>

<FatigueDetector
  machineId="EXC001"
  onEvent={(e) => socket.send(JSON.stringify(e))}
/>
```

Both emit exactly the `event` contract the simulator emits (`simulator/schemas.py`,
section 5.2) with `source: "webcam"`, so B's hub and your alert ribbon need no
special case — a webcam proximity alert and a simulated one are the same shape.

## Props

| Component | Prop | Default | Meaning |
|---|---|---|---|
| both | `machineId` | — | goes into `machine_id` on the event |
| both | `onEvent` | — | called with the event; wire it to the ingest socket |
| both | `showVideo` | `true` / `false` | draw the video feed (with boxes, for PersonDetector) |
| both | `enabled` | `true` | set `false` to release the camera entirely |
| PersonDetector | `minConfidence` | `0.5` | detector score threshold |
| FatigueDetector | `thresholdSeconds` | `1.5` | continuous eye closure that counts as a microsleep |

## Behaviour worth knowing

- **One camera between them.** Both use `useWebcam()`, which shares a single
  `MediaStream`, so the browser asks for permission once even with both mounted.
- **Debounced.** `PersonDetector` fires the instant someone appears, then at
  most once every 3 s while they stay in shot. `FatigueDetector` raises a
  `critical` microsleep and re-raises it every 4 s while the eyes stay shut, and
  a `high` alert once when drowsiness builds up.
- **Fatigue is measured, not guessed.** Both the cab `FatigueDetector` and the
  HMI operator camera (`src/lib/hmi/use-operator-camera.ts`) run the same engine,
  `operator-monitor.ts`. It learns the operator's open-eye Eye Aspect Ratio in
  the first ~3 s (look ahead normally), then tracks:

  | Signal | Rule | Alert |
  |---|---|---|
  | Microsleep | eyes closed (EAR < 65 % of baseline) ≥ 1.5 s | critical |
  | Drowsiness | PERCLOS ≥ 15 % over 60 s, or ≥ 3 long blinks (0.5–1.5 s) in 60 s, or 2 microsleeps in 5 min; clears below 8 % | high |
  | Yawning | mouth wide ≥ 1.5 s, 3 times in 10 min (eyes shut during a yawn don't count) | medium |
  | Distraction | head turned > 30° from neutral ≥ 3 s | high |
  | Head down | pitched > 25° below neutral ≥ 3 s, eyes open | high |
  | Absent | no face ≥ 3 s | high |

  All numbers live in `DMS_THRESHOLDS`. Looking down at the controls lowers the
  lids; past 15° pitch the eye-closed test gets stricter so that isn't read as
  sleep.
- **Distance is a heuristic.** `distance_m ≈ 1.2 / (boxHeight / frameHeight)`,
  calibrated so a person filling ~80% of the frame reads about 1.5 m. It is good
  enough to separate "right behind the machine" from "over there" — which is the
  only decision the alert drives — and it is not metrology.
- **They never crash the page.** No camera, denied permission or a model that
  fails to download all render a "camera unavailable" chip instead.
- **Colours.** Currently hard-coded `#FF3B30` / `#FFB020`. Swap these for your
  danger/warning design tokens — search for `DANGER_COLOR`.

## Stage fallback

If venue lighting defeats the detectors, the director scenarios `worker_behind`
and `fatigue` emit identical events:

```bash
curl -X POST localhost:8100/scenario/worker_behind
curl -X POST localhost:8100/scenario/fatigue
```

Nothing downstream can tell the difference, so the demo is safe either way.
