/**
 * PersonDetector - webcam proximity detection for the cab screen.
 *
 * Runs MediaPipe's EfficientDet-Lite0 object detector in the browser, keeps
 * only `person` detections, and turns bounding-box height into a rough
 * distance.  Emits the same `proximity_alert` event shape the simulator emits,
 * so D and B wire it to /ws/ingest without any special casing.
 *
 * Fails soft by design: if the camera or the model is unavailable this renders
 * a quiet "camera unavailable" chip and never throws.  The director's
 * `worker_behind` scenario produces an identical event, so the demo survives
 * bad venue lighting.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getObjectDetector } from "./mediapipe";
import { useWebcam } from "./useWebcam";

export type CvProximityEvent = {
  type: "event";
  event: "proximity_alert";
  severity: "high" | "critical";
  machine_id: string;
  source: "webcam";
  message: string;
  data: { distance_m: number; zone: "rear"; confidence: number };
};

type Props = {
  machineId: string;
  onEvent: (e: CvProximityEvent) => void;
  showVideo?: boolean;
  minConfidence?: number;
  /** Set false to stop the camera entirely (e.g. when the panel is hidden). */
  enabled?: boolean;
  className?: string;
};

/**
 * Calibration for the distance heuristic.
 *
 * A person filling ~80% of the frame height is about 1.5 m from the lens, and
 * apparent height falls off as 1/distance, so distance ≈ K / heightFraction
 * with K = 0.8 * 1.5.  This is a heuristic on one uncalibrated webcam, not
 * metrology - it is good enough to separate "right behind the machine" from
 * "over there", which is the decision the alert actually drives.
 */
const DISTANCE_K = 1.2;
const CRITICAL_M = 3.0;
const HIGH_M = 6.0;
const EMIT_INTERVAL_MS = 3000;
const DANGER_COLOR = "#FF3B30";   // ask D for the design-system danger token
const WARN_COLOR = "#FFB020";

function distanceFromBox(boxHeightPx: number, frameHeightPx: number): number {
  const fraction = Math.max(boxHeightPx / Math.max(frameHeightPx, 1), 0.01);
  return Math.max(0.5, DISTANCE_K / fraction);
}

export function PersonDetector({
  machineId,
  onEvent,
  showVideo = true,
  minConfidence = 0.5,
  enabled = true,
  className,
}: Props) {
  const { videoRef, status, error, retry } = useWebcam(enabled);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);
  const personPresentRef = useRef(false);
  const onEventRef = useRef(onEvent);

  const [modelState, setModelState] = useState<"loading" | "ready" | "failed">("loading");
  const [nearest, setNearest] = useState<number | null>(null);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const emit = useCallback(
    (distance: number, confidence: number) => {
      const severity: "high" | "critical" = distance < CRITICAL_M ? "critical" : "high";
      onEventRef.current({
        type: "event",
        event: "proximity_alert",
        severity,
        machine_id: machineId,
        source: "webcam",
        message: `Person detected ${distance.toFixed(1)} m behind ${machineId}`,
        data: {
          distance_m: Number(distance.toFixed(1)),
          zone: "rear",
          confidence: Number(confidence.toFixed(2)),
        },
      });
    },
    [machineId],
  );

  useEffect(() => {
    if (!enabled || status !== "ready") return;

    let cancelled = false;
    let detector: any = null;
    let lastVideoTime = -1;

    const loop = () => {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(loop);

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !detector || video.readyState < 2) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;

      let result: any;
      try {
        result = detector.detectForVideo(video, performance.now());
      } catch {
        return;   // a dropped frame is not worth tearing the component down
      }

      const people = (result?.detections ?? []).filter((d: any) =>
        d.categories?.some(
          (c: any) => c.categoryName === "person" && c.score >= minConfidence,
        ),
      );

      const ctx = canvas?.getContext("2d");
      if (canvas && ctx && showVideo) {
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      let closest: { distance: number; confidence: number } | null = null;
      for (const det of people) {
        const box = det.boundingBox;
        if (!box) continue;
        const distance = distanceFromBox(box.height, video.videoHeight || 480);
        const confidence = det.categories[0]?.score ?? 0;
        if (!closest || distance < closest.distance) {
          closest = { distance, confidence };
        }
        if (canvas && ctx && showVideo) {
          ctx.strokeStyle = distance < CRITICAL_M ? DANGER_COLOR : WARN_COLOR;
          ctx.lineWidth = 3;
          ctx.strokeRect(box.originX, box.originY, box.width, box.height);
          ctx.font = "600 14px system-ui, sans-serif";
          ctx.fillStyle = distance < CRITICAL_M ? DANGER_COLOR : WARN_COLOR;
          ctx.fillText(
            `${distance.toFixed(1)} m`,
            box.originX + 4,
            Math.max(box.originY - 6, 14),
          );
        }
      }

      setNearest(closest ? Number(closest.distance.toFixed(1)) : null);

      if (!closest || closest.distance > HIGH_M) {
        personPresentRef.current = false;
        return;
      }

      // fire the moment someone appears, then at most once every 3 s while
      // they stay in shot
      const now = performance.now();
      const appeared = !personPresentRef.current;
      if (appeared || now - lastEmitRef.current > EMIT_INTERVAL_MS) {
        lastEmitRef.current = now;
        emit(closest.distance, closest.confidence);
      }
      personPresentRef.current = true;
    };

    (async () => {
      try {
        detector = await getObjectDetector(minConfidence);
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
      personPresentRef.current = false;
    };
  }, [enabled, status, minConfidence, showVideo, emit, videoRef]);

  const unavailable =
    status === "denied" || status === "unavailable" || modelState === "failed";

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
      {showVideo && !unavailable && (
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            transform: "scaleX(-1)",
            pointerEvents: "none",
          }}
        />
      )}

      {unavailable && (
        <div
          role="status"
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            background: "rgba(0,0,0,0.5)",
            color: "#fff",
            font: "500 13px system-ui, sans-serif",
            lineHeight: 1.4,
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
      )}

      {!unavailable && nearest !== null && (
        <div
          style={{
            position: "absolute", left: 8, top: 8, padding: "3px 8px",
            borderRadius: 999, font: "600 12px system-ui, sans-serif",
            background: nearest < CRITICAL_M ? DANGER_COLOR : WARN_COLOR,
            color: "#fff",
          }}
        >
          Person {nearest} m
        </div>
      )}
    </div>
  );
}

export default PersonDetector;
