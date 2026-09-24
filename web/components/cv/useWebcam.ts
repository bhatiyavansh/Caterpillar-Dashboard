/**
 * Shared webcam access for the CV components.
 *
 * Every consumer on a page shares one MediaStream, so the browser only ever
 * asks for camera permission once and only one stream is open.
 *
 * The stream is ref-counted.  Two things this has to get right, because
 * getting them wrong silently freezes a detector while its status still reads
 * "running":
 *  - Consumers that mount in the same commit must share the *pending*
 *    getUserMedia call, not each open their own stream (the later one used to
 *    overwrite the shared handle, and the first unmount then stopped a stream
 *    another consumer was still reading).
 *  - A consumer that unmounts before its request resolves must hand its
 *    reference back when it does.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type WebcamStatus = "idle" | "starting" | "ready" | "denied" | "unavailable";

let sharedStream: MediaStream | null = null;
let pending: Promise<MediaStream> | null = null;
let refCount = 0;

async function acquire(): Promise<MediaStream> {
  refCount += 1;
  try {
    if (sharedStream && sharedStream.active) return sharedStream;
    if (!pending) {
      pending = navigator.mediaDevices
        .getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30 },
            facingMode: "user",
          },
          audio: false,
        })
        .then((stream) => {
          sharedStream = stream;
          return stream;
        })
        .finally(() => {
          pending = null;
        });
    }
    return await pending;
  } catch (err) {
    refCount = Math.max(0, refCount - 1);
    throw err;
  }
}

function release() {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && sharedStream) {
    sharedStream.getTracks().forEach((t) => t.stop());
    sharedStream = null;
  }
}

function describe(err: unknown): { status: WebcamStatus; message: string } {
  const name = (err as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return { status: "denied", message: "Camera permission denied" };
  if (name === "NotFoundError" || name === "OverconstrainedError") return { status: "unavailable", message: "No camera found" };
  if (name === "NotReadableError") return { status: "unavailable", message: "Camera is in use by another app" };
  return { status: "unavailable", message: "Camera unavailable" };
}

export function useWebcam(enabled = true) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<WebcamStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  /** Point the current <video> at the stream; safe to call as often as we like. */
  const attach = useCallback(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    if (video.paused) void video.play().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reporting a missing device API
      setStatus("unavailable");
      setError("This browser has no camera API (needs https or localhost)");
      return;
    }

    let cancelled = false;
    let held = false;
    let onEnded: (() => void) | null = null;
    let track: MediaStreamTrack | undefined;

    // Opening a camera is exactly the "synchronize with an external system" an effect is for.
    setStatus("starting");
    acquire().then(
      (stream) => {
        if (cancelled) {
          release();
          return;
        }
        held = true;
        streamRef.current = stream;
        attach();
        track = stream.getVideoTracks()[0];
        onEnded = () => {
          setStatus("unavailable");
          setError("Camera disconnected");
        };
        track?.addEventListener("ended", onEnded);
        setStatus("ready");
        setError(null);
      },
      (err) => {
        if (cancelled) return;
        const { status: s, message } = describe(err);
        setStatus(s);
        setError(message);
      },
    );

    // Capture the element now: by the time cleanup runs React may already have detached it.
    const video = videoRef.current;
    return () => {
      cancelled = true;
      if (track && onEnded) track.removeEventListener("ended", onEnded);
      if (video && video.srcObject === streamRef.current) video.srcObject = null;
      streamRef.current = null;
      if (held) release();
      setStatus("idle");
    };
  }, [enabled, attempt, attach]);

  // The <video> can mount after the stream arrives (conditional render, sheet animations), or be
  // swapped for a new element; keep whichever one is current wired to the stream.
  useEffect(() => {
    attach();
  });

  const retry = useCallback(async () => {
    setAttempt((n) => n + 1);
  }, []);

  return { videoRef, status: enabled ? status : "idle", error, retry };
}
