/**
 * Driver-monitoring engine: turns FaceLandmarker output into operator state.
 *
 * Pure TypeScript, no React and no DOM, so the HMI operator camera and the cab
 * FatigueDetector run exactly the same logic and thresholds.
 *
 * Why not just threshold the `eyeBlink*` blendshapes?  They vary a lot between
 * faces — for many people fully closed eyes score 0.3–0.5, and looking down at
 * the controls scores higher than a blink — so a fixed "both > 0.5" either
 * never fires or fires all day.  The signal here is the Eye Aspect Ratio
 * (Soukupová & Čech, 2016) measured against *this operator's* open-eye
 * baseline, learned in the first few seconds and tracked slowly afterwards,
 * with the blendshape only as corroboration.
 *
 * Measures and the thresholds they are held to (see DMS_THRESHOLDS):
 *  - Eye closure: EAR below 65 % of the open baseline (roughly lids 70–80 %
 *    closed, the "P80" criterion PERCLOS is defined on), with hysteresis.
 *  - Microsleep: eyes continuously closed ≥ 1.5 s.  A normal blink is
 *    100–400 ms; 0.5–1.5 s is a "long blink", itself a drowsiness marker.
 *  - PERCLOS: share of the last 60 s with eyes closed.  ≥ 15 % is the usual
 *    drowsy threshold (Wierwille 1994; FHWA/Dinges 1998); clears below 8 %.
 *  - Long blinks: ≥ 3 in 60 s also counts as drowsy.
 *  - Yawns: mouth wide open ≥ 1.5 s (speech never holds that); 3 in 10 min is
 *    an early fatigue sign.  Eye closure during a yawn (up to 8 s) is not a
 *    microsleep.
 *  - Distraction: head turned > 30° from the operator's neutral for ≥ 3 s
 *    (the Euro NCAP "long distraction" duration).
 *  - Head down: pitched > 25° below neutral for ≥ 3 s with eyes open.
 *  - Absent: no face for ≥ 3 s.
 */
import type { FaceLandmarkerResult } from "./mediapipe";

export const DMS_THRESHOLDS = {
  /** Seconds of usable open-eyed frames used to learn the baseline and neutral pose. */
  CALIBRATION_S: 3,
  /** Operator gone this long → forget the calibration (probably a different person next). */
  RECALIBRATE_AFTER_ABSENT_S: 30,

  /** Eyes closed when EAR drops below this share of the operator's open-eye EAR. */
  EAR_CLOSED_RATIO: 0.65,
  /** ...and open again once it is back above this share (hysteresis). */
  EAR_OPEN_RATIO: 0.78,
  /**
   * Before calibration: population values for MediaPipe's mesh.  Open eyes
   * measure roughly 0.20–0.32 depending on the face, closed ones 0.03–0.10.
   */
  EAR_ABS_CLOSED: 0.14,
  EAR_ABS_OPEN: 0.17,
  /** Blendshape corroboration: closes on its own only when very confident. */
  BLINK_SCORE_CLOSED: 0.72,
  BLINK_SCORE_OPEN: 0.55,
  /** Looking down lowers the lids without closing them: be stricter past this pitch. */
  LOOK_DOWN_DEG: 15,

  /** Closures shorter than this are ordinary blinks. */
  LONG_BLINK_S: 0.5,
  /** Continuous eye closure that counts as a microsleep. */
  MICROSLEEP_S: 1.5,
  /** Keep the microsleep condition up this long after the eyes open, so the alert is seen. */
  MICROSLEEP_HOLD_S: 3,

  PERCLOS_WINDOW_S: 60,
  /** Don't judge PERCLOS on less than this much face time. */
  PERCLOS_MIN_DATA_S: 20,
  PERCLOS_DROWSY: 0.15,
  PERCLOS_CLEAR: 0.08,
  LONG_BLINKS_DROWSY: 3,
  /** Two microsleeps within this window also mean drowsy. */
  MICROSLEEP_WINDOW_S: 300,

  /** Yawn: mouth aspect ratio (lip gap / mouth width) or jawOpen blendshape. Speech stays under ~0.45. */
  YAWN_MAR: 0.6,
  YAWN_JAW: 0.6,
  YAWN_MIN_S: 1.5,
  /** A yawn can excuse closed eyes for this long; a jaw hanging open in sleep cannot. */
  YAWN_MAX_S: 8,
  YAWN_WINDOW_S: 600,
  YAWNS_FATIGUE: 3,

  DISTRACTED_YAW_DEG: 30,
  DISTRACTED_S: 3,
  HEAD_DOWN_DEG: 25,
  HEAD_DOWN_S: 3,
  ABSENT_S: 3,
} as const;

export type DmsCondition = "absent" | "microsleep" | "drowsy" | "yawning" | "distracted" | "head_down";

export interface DmsMetrics {
  face: boolean;
  calibrated: boolean;
  /** 0–1 progress of the initial calibration. */
  calibration: number;
  /** Mean eye aspect ratio this frame. */
  ear: number | null;
  earBaseline: number | null;
  /** EAR as a share of the operator's open baseline, 0 (closed) – ~1 (normal open). */
  eyeOpenness: number | null;
  eyesClosed: boolean;
  /** Current continuous eye-closure, seconds. */
  eyesClosedS: number;
  /** Share of the last 60 s with eyes closed, once there is enough data. */
  perclos: number | null;
  blinksPerMin: number | null;
  longBlinks: number;
  microsleeps: number;
  yawns: number;
  yawning: boolean;
  /** Head pose relative to the operator's neutral, degrees. Pitch > 0 is head down. */
  yawDeg: number | null;
  pitchDeg: number | null;
}

export interface DmsOutput {
  metrics: DmsMetrics;
  conditions: Record<DmsCondition, boolean>;
}

/** Condition that must hold for `onS` (bridging dropouts up to `graceS`) and clears after `offS`. */
export class Latch {
  private since: number | null = null;
  private lastTrue = -Infinity;
  active = false;

  constructor(
    private readonly onS: number,
    private readonly offS = 0.5,
    private readonly graceS = 0.3,
  ) {}

  update(cond: boolean, t: number): boolean {
    if (cond) {
      this.lastTrue = t;
      if (this.since === null) this.since = t;
    } else if (this.since !== null && t - this.lastTrue > this.graceS) {
      this.since = null;
    }
    if (!this.active && this.since !== null && t - this.since >= this.onS) this.active = true;
    if (this.active && !cond && t - this.lastTrue >= this.offS) this.active = false;
    return this.active;
  }

  reset() {
    this.since = null;
    this.lastTrue = -Infinity;
    this.active = false;
  }
}

type Vec = { x: number; y: number; z: number };

// Eye Aspect Ratio points, p1..p6: outer/inner corners at p1/p4, upper lid p2 p3, lower lid p6 p5.
const RIGHT_EYE = [33, 160, 158, 133, 153, 144] as const;
const LEFT_EYE = [362, 385, 387, 263, 373, 380] as const;
const LIP_TOP = 13;
const LIP_BOTTOM = 14;
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;
const NOSE_TIP = 1;
const CHEEK_RIGHT = 234;
const CHEEK_LEFT = 454;

const T = DMS_THRESHOLDS;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const DEG = 180 / Math.PI;

function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/** Time-weighted rolling window of samples, trimmed by age. */
class Window<V> {
  private items: { t: number; v: V }[] = [];
  constructor(private readonly spanS: number) {}
  push(t: number, v: V) {
    this.items.push({ t, v });
    this.trim(t);
  }
  trim(t: number) {
    let i = 0;
    while (i < this.items.length && t - this.items[i].t > this.spanS) i++;
    if (i) this.items.splice(0, i);
  }
  get values() {
    return this.items;
  }
  clear() {
    this.items = [];
  }
}

export class OperatorMonitor {
  private lastT: number | null = null;
  private noFaceSince: number | null = null;

  // calibration
  private calibT = 0;
  private calibEar: number[] = [];
  private calibYaw: number[] = [];
  private calibPitch: number[] = [];
  private baseline: number | null = null;
  private initialBaseline = 0;
  private neutralYaw = 0;
  private neutralPitch = 0;

  // smoothed head pose, raw degrees
  private yawS: number | null = null;
  private pitchS: number | null = null;

  // eyes
  private eyesClosed = false;
  private closedSince: number | null = null;
  private perclos = new Window<{ dt: number; closed: boolean }>(T.PERCLOS_WINDOW_S);
  private blinks = new Window<number>(T.PERCLOS_WINDOW_S);
  private longBlinks = new Window<number>(T.PERCLOS_WINDOW_S);
  private microsleeps = new Window<number>(T.MICROSLEEP_WINDOW_S);
  private drowsy = false;

  // mouth
  private yawnTimes = new Window<number>(T.YAWN_WINDOW_S);
  private yawnLatch = new Latch(T.YAWN_MIN_S, 1.0, 0.1);
  private mouthWideSince: number | null = null;

  private absentLatch = new Latch(T.ABSENT_S, 0.5, 0);
  private microsleepLatch = new Latch(0, T.MICROSLEEP_HOLD_S, 0);
  private distractedLatch = new Latch(T.DISTRACTED_S, 0.75);
  private headDownLatch = new Latch(T.HEAD_DOWN_S, 0.75);

  /** Forget the operator: next frames re-learn baseline and neutral pose. */
  recalibrate() {
    this.calibT = 0;
    this.calibEar = [];
    this.calibYaw = [];
    this.calibPitch = [];
    this.baseline = null;
    this.yawS = null;
    this.pitchS = null;
  }

  reset() {
    this.recalibrate();
    this.lastT = null;
    this.noFaceSince = null;
    this.eyesClosed = false;
    this.closedSince = null;
    this.perclos.clear();
    this.blinks.clear();
    this.longBlinks.clear();
    this.microsleeps.clear();
    this.yawnTimes.clear();
    this.drowsy = false;
    this.mouthWideSince = null;
    for (const l of [this.yawnLatch, this.absentLatch, this.microsleepLatch, this.distractedLatch, this.headDownLatch]) l.reset();
  }

  /**
   * Feed one frame.  `width`/`height` are the video's pixel size: landmarks are
   * normalised per axis, so distances are only meaningful after scaling back.
   */
  update(result: FaceLandmarkerResult | null | undefined, width: number, height: number, nowMs: number): DmsOutput {
    const t = nowMs / 1000;
    const dt = this.lastT === null ? 0 : clamp(t - this.lastT, 0, 0.25);
    this.lastT = t;

    const lm = result?.faceLandmarks?.[0];
    if (!lm || lm.length < 468) return this.noFace(t);
    this.noFaceSince = null;

    const W = width || 640;
    const H = height || 480;
    const P = (i: number): Vec => ({ x: lm[i].x * W, y: lm[i].y * H, z: (lm[i].z ?? 0) * W });
    const shapes = result?.faceBlendshapes?.[0]?.categories ?? [];
    const shape = (name: string) => shapes.find((c) => c.categoryName === name)?.score ?? 0;

    // ---- head pose: nose tip relative to the midpoint of the face's sides, in 3D
    const nose = P(NOSE_TIP);
    const cr = P(CHEEK_RIGHT);
    const cl = P(CHEEK_LEFT);
    const f = { x: nose.x - (cr.x + cl.x) / 2, y: nose.y - (cr.y + cl.y) / 2, z: nose.z - (cr.z + cl.z) / 2 };
    const depth = Math.max(1e-3, -f.z);
    const yawRaw = Math.atan2(f.x, depth) * DEG;
    const pitchRaw = Math.atan2(f.y, Math.hypot(f.x, depth)) * DEG; // image y grows downward: + = head down
    this.yawS = this.yawS === null ? yawRaw : this.yawS + (yawRaw - this.yawS) * 0.35;
    this.pitchS = this.pitchS === null ? pitchRaw : this.pitchS + (pitchRaw - this.pitchS) * 0.35;

    // ---- eyes
    const earOf = (idx: readonly number[]) => {
      const [p1, p2, p3, p4, p5, p6] = idx.map(P);
      const w = dist(p1, p4);
      return { ear: w > 1e-3 ? (dist(p2, p6) + dist(p3, p5)) / (2 * w) : 0, width: w };
    };
    const re = earOf(RIGHT_EYE);
    const le = earOf(LEFT_EYE);
    // With the head turned, the far eye is foreshortened and unreliable; trust the near one.
    const turned = Math.abs(this.yawS - this.neutralYaw) > 25;
    const ear = turned ? (re.width > le.width ? re.ear : le.ear) : (re.ear + le.ear) / 2;
    const blink = (shape("eyeBlinkLeft") + shape("eyeBlinkRight")) / 2;

    // ---- mouth
    const mouthW = dist(P(MOUTH_LEFT), P(MOUTH_RIGHT));
    const mar = mouthW > 1e-3 ? dist(P(LIP_TOP), P(LIP_BOTTOM)) / mouthW : 0;
    const mouthWide = mar > T.YAWN_MAR || shape("jawOpen") > T.YAWN_JAW;
    if (!mouthWide) this.mouthWideSince = null;
    else this.mouthWideSince ??= t;
    const yawnExcuse = mouthWide && t - (this.mouthWideSince ?? t) < T.YAWN_MAX_S;

    // ---- calibration
    if (this.baseline === null) {
      // Only frames that look like "eyes open, mouth shut, facing roughly forward".
      if (blink < 0.35 && !mouthWide && ear > 0.12 && Math.abs(yawRaw) < 30) {
        this.calibT += dt;
        this.calibEar.push(ear);
        this.calibYaw.push(yawRaw);
        this.calibPitch.push(pitchRaw);
      }
      if (this.calibT >= T.CALIBRATION_S && this.calibEar.length >= 20) {
        // Upper-middle of the distribution: blinks pull the median down.
        this.baseline = clamp(quantile(this.calibEar, 0.7), 0.16, 0.45);
        this.initialBaseline = this.baseline;
        this.neutralYaw = clamp(quantile(this.calibYaw, 0.5), -20, 20);
        this.neutralPitch = clamp(quantile(this.calibPitch, 0.5), -25, 25);
      }
    }
    const calibrated = this.baseline !== null;
    const yawRel = this.yawS - (calibrated ? this.neutralYaw : 0);
    const pitchRel = this.pitchS - (calibrated ? this.neutralPitch : 0);

    // ---- eye state with hysteresis
    const closedThr = calibrated ? this.baseline! * T.EAR_CLOSED_RATIO : T.EAR_ABS_CLOSED;
    const openThr = calibrated ? this.baseline! * T.EAR_OPEN_RATIO : T.EAR_ABS_OPEN;
    const lookingDown = calibrated && pitchRel > T.LOOK_DOWN_DEG;
    const closing = lookingDown
      ? ear < closedThr * 0.8 && blink > 0.45
      : ear < closedThr || (blink > T.BLINK_SCORE_CLOSED && ear < openThr);
    const opening =
      (ear > openThr && blink < T.BLINK_SCORE_OPEN) ||
      (calibrated ? ear > this.baseline! * 0.9 : ear > T.EAR_ABS_OPEN + 0.03) ||
      // Head tilting down lowers the lids as it goes; once it's down, only the strict test holds them closed.
      (lookingDown && !closing);

    if (!this.eyesClosed && closing) {
      this.eyesClosed = true;
      this.closedSince = t;
    } else if (this.eyesClosed && opening) {
      const d = t - (this.closedSince ?? t);
      if (d >= T.MICROSLEEP_S) this.microsleeps.push(t, d);
      else if (d >= T.LONG_BLINK_S) this.longBlinks.push(t, d);
      else if (d >= 0.05) this.blinks.push(t, d);
      this.eyesClosed = false;
      this.closedSince = null;
    }
    // Eyes squeezed shut in a yawn are not asleep: keep restarting the clock while the mouth is wide.
    if (this.eyesClosed && yawnExcuse) this.closedSince = t;
    const closedS = this.eyesClosed && this.closedSince !== null ? t - this.closedSince : 0;

    // Keep the open baseline honest over lighting/posture changes, but only from clearly-open,
    // forward-facing frames and never far from what calibration found.
    if (calibrated && !this.eyesClosed && !mouthWide && Math.abs(yawRel) < 15 && Math.abs(pitchRel) < 12) {
      const r = ear / this.baseline!;
      if (r > 0.85 && r < 1.35) {
        this.baseline = clamp(this.baseline! + (ear - this.baseline!) * 0.005, this.initialBaseline * 0.85, this.initialBaseline * 1.25);
      }
    }

    // ---- rolling windows
    if (dt > 0) this.perclos.push(t, { dt, closed: this.eyesClosed && !yawnExcuse });
    this.blinks.trim(t);
    this.longBlinks.trim(t);
    this.microsleeps.trim(t);
    this.yawnTimes.trim(t);
    let total = 0;
    let closedTime = 0;
    for (const { v } of this.perclos.values) {
      total += v.dt;
      if (v.closed) closedTime += v.dt;
    }
    const perclos = total >= T.PERCLOS_MIN_DATA_S ? closedTime / total : null;
    const blinksPerMin = total >= T.PERCLOS_MIN_DATA_S ? ((this.blinks.values.length + this.longBlinks.values.length) * 60) / total : null;

    // ---- yawns
    const wasYawning = this.yawnLatch.active;
    const yawning = this.yawnLatch.update(mouthWide, t);
    if (yawning && !wasYawning) this.yawnTimes.push(t, t);

    // ---- conditions
    const longBlinkCount = this.longBlinks.values.length;
    const microsleepCount = this.microsleeps.values.length;
    const microsleep = this.microsleepLatch.update(closedS >= T.MICROSLEEP_S, t);
    if (!this.drowsy) {
      this.drowsy =
        (perclos !== null && perclos >= T.PERCLOS_DROWSY) || longBlinkCount >= T.LONG_BLINKS_DROWSY || microsleepCount >= 2;
    } else {
      const recentMicrosleep = this.microsleeps.values.some((m) => t - m.t < T.PERCLOS_WINDOW_S);
      this.drowsy = !((perclos === null || perclos < T.PERCLOS_CLEAR) && longBlinkCount < 2 && !recentMicrosleep);
    }

    const conditions: Record<DmsCondition, boolean> = {
      absent: this.absentLatch.update(false, t),
      microsleep,
      drowsy: this.drowsy,
      yawning: this.yawnTimes.values.length >= T.YAWNS_FATIGUE,
      distracted: this.distractedLatch.update(calibrated && Math.abs(yawRel) > T.DISTRACTED_YAW_DEG, t),
      head_down: this.headDownLatch.update(calibrated && pitchRel > T.HEAD_DOWN_DEG && !this.eyesClosed, t),
    };

    return {
      conditions,
      metrics: {
        face: true,
        calibrated,
        calibration: calibrated ? 1 : clamp(this.calibT / T.CALIBRATION_S, 0, 0.99),
        ear,
        earBaseline: this.baseline,
        eyeOpenness: calibrated ? clamp(ear / this.baseline!, 0, 1.5) : null,
        eyesClosed: this.eyesClosed,
        eyesClosedS: closedS,
        perclos,
        blinksPerMin,
        longBlinks: longBlinkCount,
        microsleeps: microsleepCount,
        yawns: this.yawnTimes.values.length,
        yawning: mouthWide,
        yawDeg: calibrated ? yawRel : null,
        pitchDeg: calibrated ? pitchRel : null,
      },
    };
  }

  private noFace(t: number): DmsOutput {
    this.noFaceSince ??= t;
    if (t - this.noFaceSince > T.RECALIBRATE_AFTER_ABSENT_S && this.baseline !== null) this.recalibrate();
    // A closure we can no longer see is not timed; a head that drops out of frame is "absent".
    this.eyesClosed = false;
    this.closedSince = null;
    this.yawnLatch.update(false, t);
    this.mouthWideSince = null;
    const absent = this.absentLatch.update(true, t);
    const calibrated = this.baseline !== null;
    return {
      conditions: {
        absent,
        microsleep: this.microsleepLatch.update(false, t),
        drowsy: this.drowsy,
        yawning: this.yawnTimes.values.length >= T.YAWNS_FATIGUE,
        distracted: this.distractedLatch.update(false, t),
        head_down: this.headDownLatch.update(false, t),
      },
      metrics: {
        face: false,
        calibrated,
        calibration: calibrated ? 1 : clamp(this.calibT / T.CALIBRATION_S, 0, 0.99),
        ear: null,
        earBaseline: this.baseline,
        eyeOpenness: null,
        eyesClosed: false,
        eyesClosedS: 0,
        perclos: null,
        blinksPerMin: null,
        longBlinks: this.longBlinks.values.length,
        microsleeps: this.microsleeps.values.length,
        yawns: this.yawnTimes.values.length,
        yawning: false,
        yawDeg: null,
        pitchDeg: null,
      },
    };
  }
}
