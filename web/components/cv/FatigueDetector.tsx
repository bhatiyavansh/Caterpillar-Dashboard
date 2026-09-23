/**
 * FatigueDetector - eyes-closed detection for the cab screen.
 *
 * MediaPipe FaceLandmarker with blendshapes: when both `eyeBlinkLeft` and
 * `eyeBlinkRight` exceed the blink threshold the eyes are closed, and we time
 * how long that lasts.  A blink is ~0.2 s; anything past `thresholdSeconds` is
 * microsleep territory and fires a `fatigue_alert` in the simulator's event
 * shape.
 *
 * Fails soft, exactly like PersonDetector - the director's `fatigue` scenario
 * produces an identical event if the venue lighting defeats the model.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getFaceLandmarker } from "./mediapipe";
import { useWebcam } from "./useWebcam";

export type CvFatigueEvent = {
  type: "event";
  event: "fatigue_alert";
  severity: "high";
  machine_id: string;
  source: "webcam";
  message: string;
  data: { eyes_closed_s: number; fatigue_score: number };
};

type Props = {
  machineId: string;
  onEvent: (e: CvFatigueEvent) => void;
  /** Seconds of continuous eye closure before alerting.  A blink is ~0.2 s. */
  thresholdSeconds?: number;
  showVideo?: boolean;
  enabled?: boolean;
  className?: string;
};

const BLINK_THRESHOLD = 0.5;
const SCORE_SATURATION_S = 4;      // fatigue_score reaches 1.0 here
const REALERT_INTERVAL_MS = 5000;
const DANGER_COLOR = "#FF3B30";

export function FatigueDetector({
  machineId,
  onEvent,
  thresholdSeconds = 2,
  showVideo = false,
  enabled = true,
  className,
}: Props) {
  const { videoRef, status, error, retry } = useWebcam(enabled);
  const rafRef = useRef<number | null>(null);
  const closedSinceRef = useRef<number | null>(null);
  const lastAlertRef = useRef(0);
  const onEventRef = useRef(onEvent);

  const [modelState, setModelState] = useState<"loading" | "ready" | "failed">("loading");
  const [closedSeconds, setClosedSeconds] = useState(0);
  const [faceSeen, setFaceSeen] = useState(false);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const emit = useCallback(
    (eyesClosedS: number) => {
      const score = Math.min(1, eyesClosedS / SCORE_SATURATION_S);
      onEventRef.current({
        type: "event",
        event: "fatigue_alert",
        severity: "high",
        machine_id: machineId,
        source: "webcam",
        message: `Operator fatigue detected on ${machineId} - take a break`,
        data: {
          eyes_closed_s: Number(eyesClosedS.toFixed(1)),
          fatigue_score: Number(score.toFixed(2)),
        },
      });
    },
    [machineId],
  );

  useEffect(() => {
    if (!enabled || status !== "ready") return;

    let cancelled = false;
    let landmarker: any = null;
    let lastVideoTime = -1;

    const loop = () => {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(loop);

      const video = videoRef.current;
      if (!video || !landmarker || video.readyState < 2) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      let result: any;
      try {
        result = landmarker.detectForVideo(video, performance.now());
      } catch {
        return;
      }

      const shapes = result?.faceBlendshapes?.[0]?.categories;
      if (!shapes) {
        setFaceSeen(false);
        closedSinceRef.current = null;
        setClosedSeconds(0);
        return;
      }
      setFaceSeen(true);

      const score = (name: string) =>
        shapes.find((c: any) => c.categoryName === name)?.score ?? 0;
      const eyesClosed =
        score("eyeBlinkLeft") > BLINK_THRESHOLD &&
        score("eyeBlinkRight") > BLINK_THRESHOLD;

      const now = performance.now();
      if (!eyesClosed) {
        closedSinceRef.current = null;
        setClosedSeconds(0);
        return;
      }

      if (closedSinceRef.current === null) closedSinceRef.current = now;
      const elapsed = (now - closedSinceRef.current) / 1000;
      setClosedSeconds(Number(elapsed.toFixed(1)));

      if (elapsed >= thresholdSeconds && now - lastAlertRef.current > REALERT_INTERVAL_MS) {
        lastAlertRef.current = now;
        emit(elapsed);
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
      closedSinceRef.current = null;
    };
  }, [enabled, status, thresholdSeconds, emit, videoRef]);

  const unavailable =
    status === "denied" || status === "unavailable" || modelState === "failed";
  const alerting = closedSeconds >= thresholdSeconds;

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
            padding: "6px 10px", borderRadius: 999, display: "inline-block",
            font: "600 12px system-ui, sans-serif",
            background: alerting ? DANGER_COLOR : "rgba(0,0,0,0.45)",
            color: "#fff",
          }}
        >
          {!faceSeen
            ? "No face in view"
            : alerting
              ? `Eyes closed ${closedSeconds.toFixed(1)} s`
              : "Alert"}
        </div>
      )}
    </div>
  );
}

export default FatigueDetector;
