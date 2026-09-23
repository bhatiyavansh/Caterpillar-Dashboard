/**
 * Shared webcam access for the CV components.
 *
 * Both detectors can run off one <video> element, so the browser only ever
 * asks for camera permission once and only one MediaStream is open.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type WebcamStatus = "idle" | "starting" | "ready" | "denied" | "unavailable";

let sharedStream: MediaStream | null = null;
let sharedRefCount = 0;

async function acquire(): Promise<MediaStream> {
  if (sharedStream && sharedStream.active) {
    sharedRefCount += 1;
    return sharedStream;
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    audio: false,
  });
  sharedStream = stream;
  sharedRefCount = 1;
  return stream;
}

function release() {
  sharedRefCount -= 1;
  if (sharedRefCount <= 0 && sharedStream) {
    sharedStream.getTracks().forEach((t) => t.stop());
    sharedStream = null;
    sharedRefCount = 0;
  }
}

export function useWebcam(enabled = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState<WebcamStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      setError("This browser has no camera API");
      return;
    }
    setStatus("starting");
    try {
      const stream = await acquire();
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStatus("ready");
      setError(null);
    } catch (err) {
      const name = (err as DOMException)?.name;
      setStatus(name === "NotAllowedError" ? "denied" : "unavailable");
      setError(
        name === "NotAllowedError"
          ? "Camera permission denied"
          : "Camera unavailable",
      );
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let released = false;
    void start();
    return () => {
      if (!released) {
        released = true;
        if (videoRef.current) videoRef.current.srcObject = null;
        release();
      }
    };
  }, [enabled, start]);

  return { videoRef, status, error, retry: start };
}
