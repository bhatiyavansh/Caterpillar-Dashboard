/**
 * FatigueDetector - operator drowsiness detection for the cab screen.
 *
 * Runs MediaPipe FaceLandmarker through the shared driver-monitoring engine
 * (`operator-monitor.ts`), which calibrates to this operator's open-eye
 * Eye Aspect Ratio and tracks eye closure, PERCLOS, long blinks and yawns.
 * It raises a `fatigue_alert` in the simulator's event shape:
 *  - `critical` on a microsleep (eyes closed ≥ `thresholdSeconds`, default
 *    1.5 s), repeated every few seconds while the eyes stay shut;
 *  - `high` when drowsiness builds up (PERCLOS ≥ 15 % over 60 s, or 3+ long
 *    blinks in a minute).
 *
 * Fails soft, exactly like PersonDetector - the director's `fatigue` scenario
 * produces an identical event if the venue lighting defeats the model.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getFaceLandmarker, nextTimestamp, type FaceLandmarker, type FaceLandmarkerResult } from "./mediapipe";
import { DMS_THRESHOLDS, OperatorMonitor, type DmsMetrics } from "./operator-monitor";
import { useWebcam } from "./useWebcam";

export type CvFatigueEvent = {
  type: "event";
  event: "fatigue_alert";
  severity: "high" | "critical";
  machine_id: string;
  source: "webcam";
  message: string;
  data: {
    condition: "microsleep" | "drowsy";
    eyes_closed_s: number;
    fatigue_score: number;
    perclos: number | null;
    long_blinks_60s: number;
    microsleeps_5min: number;
    yawns_10min: number;
  };
};

type Props = {
  machineId: string;
  onEvent: (e: CvFatigueEvent) => void;
  /** Continuous eye closure that counts as a microsleep, seconds.  A blink is 0.1–0.4 s. */
  thresholdSeconds?: number;
  showVideo?: boolean;
  enabled?: boolean;
  className?: string;
};

/** While the eyes stay shut, re-raise the microsleep this often. */
const REALERT_INTERVAL_MS = 4000;
const UI_INTERVAL_MS = 150;
const DANGER_COLOR = "#FF3B30";
const WARN_COLOR = "#FFB020";

/** 0–1 blend of the fatigue measures, for dashboards that want one number. */
function fatigueScore(m: DmsMetrics): number {
  const T = DMS_THRESHOLDS;
  const closure = Math.min(1, m.eyesClosedS / (T.MICROSLEEP_S * 2));
  const perclos = m.perclos === null ? 0 : Math.min(1, m.perclos / (T.PERCLOS_DROWSY * 2));
  const blinks = Math.min(1, m.longBlinks / (T.LONG_BLINKS_DROWSY * 2));
  const yawns = Math.min(1, m.yawns / (T.YAWNS_FATIGUE * 2));
  return Math.max(closure, perclos, 0.8 * blinks, 0.5 * yawns);
}

export function FatigueDetector({
  machineId,
  onEvent,
  thresholdSeconds = DMS_THRESHOLDS.MICROSLEEP_S,
  showVideo = false,
  enabled = true,
  className,
}: Props) {
  const { videoRef, status, error, retry } = useWebcam(enabled);
  const rafRef = useRef<number | null>(null);
  const onEventRef = useRef(onEvent);

  const [modelState, setModelState] = useState<"loading" | "ready" | "failed">("loading");
  const [metrics, setMetrics] = useState<DmsMetrics | null>(null);
  const [drowsy, setDrowsy] = useState(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const emit = useCallback(
    (condition: "microsleep" | "drowsy", m: DmsMetrics) => {
      const message =
        condition === "microsleep"
          ? `Microsleep on ${machineId}: eyes closed ${m.eyesClosedS.toFixed(1)} s - stop and take a break`
          : `Operator drowsiness building on ${machineId}` +
            (m.perclos !== null ? ` (eyes closed ${Math.round(m.perclos * 100)}% of the last minute)` : "") +
            " - plan a break now";
      onEventRef.current({
        type: "event",
        event: "fatigue_alert",
        severity: condition === "microsleep" ? "critical" : "high",
        machine_id: machineId,
        source: "webcam",
        message,
        data: {
          condition,
          eyes_closed_s: Number(m.eyesClosedS.toFixed(1)),
          fatigue_score: Number(fatigueScore(m).toFixed(2)),
          perclos: m.perclos === null ? null : Number(m.perclos.toFixed(3)),
          long_blinks_60s: m.longBlinks,
          microsleeps_5min: m.microsleeps,
          yawns_10min: m.yawns,
        },
      });
    },
    [machineId],
  );

  useEffect(() => {
    if (!enabled || status !== "ready") return;

    let cancelled = false;
    let landmarker: FaceLandmarker | null = null;
    let lastVideoTime = -1;
    let lastUi = 0;
    let lastMicrosleepAlert = 0;
    let wasDrowsy = false;
    const monitor = new OperatorMonitor();

    const loop = () => {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(loop);

      const video = videoRef.current;
      if (!video || !landmarker || video.readyState < 2 || !video.videoWidth) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      let result: FaceLandmarkerResult;
      try {
        result = landmarker.detectForVideo(video, nextTimestamp(landmarker));
      } catch {
        return;
      }

      const now = performance.now();
      const { conditions, metrics: m } = monitor.update(result, video.videoWidth, video.videoHeight, now);

      if (m.eyesClosedS >= thresholdSeconds && now - lastMicrosleepAlert > REALERT_INTERVAL_MS) {
        lastMicrosleepAlert = now;
        emit("microsleep", m);
      }
      if (conditions.drowsy && !wasDrowsy) emit("drowsy", m);
      wasDrowsy = conditions.drowsy;

      if (now - lastUi > UI_INTERVAL_MS) {
        lastUi = now;
        setMetrics(m);
        setDrowsy(conditions.drowsy);
      }
    };

    (async () => {
      try {
        landmarker = await getFaceLandmarker();
        if (cancelled) return;
        setModelState("ready");
        rafRef.current = requestAnimationFrame(loop);
      } catch {
        if (!cancelled) setModelState("failed");
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, status, thresholdSeconds, emit, videoRef]);

  const unavailable =
    status === "denied" || status === "unavailable" || modelState === "failed";
  const microsleep = (metrics?.eyesClosedS ?? 0) >= thresholdSeconds;

  let chip = "Starting camera";
  let chipColor = "rgba(0,0,0,0.45)";
  if (modelState === "loading" && status === "ready") chip = "Loading model";
  else if (metrics && !metrics.face) chip = "No face in view";
  else if (microsleep) {
    chip = `Eyes closed ${metrics!.eyesClosedS.toFixed(1)} s`;
    chipColor = DANGER_COLOR;
  } else if (drowsy) {
    chip = metrics?.perclos != null ? `Drowsy · PERCLOS ${Math.round(metrics.perclos * 100)}%` : "Drowsy";
    chipColor = WARN_COLOR;
  } else if (metrics && !metrics.calibrated) chip = `Calibrating ${Math.round(metrics.calibration * 100)}%`;
  else if (metrics?.eyesClosed) chip = "Eyes closed";
  else if (metrics) chip = metrics.perclos != null ? `Alert · PERCLOS ${Math.round(metrics.perclos * 100)}%` : "Alert";

  return (
    <div className={className} style={{ position: "relative", lineHeight: 0 }}>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          width: "100%",
          display: showVideo && !unavailable ? "block" : "none",
          borderRadius: 8,
          transform: "scaleX(-1)",
        }}
      />

      {unavailable ? (
        <div
          role="status"
          style={{
            padding: "12px 14px", borderRadius: 8, background: "rgba(0,0,0,0.5)",
            color: "#fff", font: "500 13px system-ui, sans-serif", lineHeight: 1.4,
          }}
        >
          Camera unavailable
          <div style={{ opacity: 0.7, fontSize: 12 }}>
            {error ?? "Detector failed to load"}
          </div>
          {status === "denied" && (
            <button
              onClick={() => void retry()}
              style={{
                marginTop: 8, padding: "4px 10px", borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.3)", background: "transparent",
                color: "#fff", font: "500 12px system-ui, sans-serif", cursor: "pointer",
              }}
            >
              Try again
            </button>
          )}
        </div>
      ) : (
        <div
          style={{
            position: showVideo ? "absolute" : "static", left: 8, bottom: 8,
            padding: "6px 10px", borderRadius: 999, display: "inline-block",
            font: "600 12px system-ui, sans-serif", lineHeight: 1.2,
            background: chipColor,
            color: chipColor === WARN_COLOR ? "#1a1305" : "#fff",
          }}
        >
          {chip}
        </div>
      )}
    </div>
  );
}

export default FatigueDetector;
