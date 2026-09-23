"use client";
/**
 * useVoice: free, in-browser voice for the assistant.
 *   speech-to-text: Web Speech API (SpeechRecognition, en-IN), push-to-talk
 *   text-to-speech: speechSynthesis (browser voice); pressing talk again interrupts (barge-in)
 * "confirm" / "cancel" while an action is pending are resolved locally by useAssistant (never the LLM).
 * Unsupported browser (e.g. Firefox STT): `sttSupported` is false - show a text box instead.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAssistant, type UseAssistantOptions } from "../assistant/hooks";

export type AvatarState = "idle" | "listening" | "thinking" | "talking" | "alert"; // same names as D's AvatarSlot

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseVoiceOptions extends UseAssistantOptions {
  /** True while a safety alert is active for this surface (drives the avatar's alert state). */
  alert?: boolean;
  lang?: string;
}

export function useVoice(opts: UseVoiceOptions) {
  const assistant = useAssistant(opts);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [pulse, setPulse] = useState(0); // increments on each spoken word: procedural lip sync
  const [micError, setMicError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const spokenRef = useRef<string | null>(null);
  const [sttSupported] = useState(() => recognitionCtor() !== null);
  const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
  const lang = opts.lang ?? "en-IN";

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || !text) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 1.02;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      u.onboundary = () => setPulse((p) => p + 1);
      window.speechSynthesis.speak(u);
    },
    [lang, ttsSupported],
  );

  // speak each new assistant answer once (external side effect only; no state set here)
  const last = assistant.messages[assistant.messages.length - 1];
  useEffect(() => {
    if (last && last.role === "assistant" && spokenRef.current !== last.id) {
      spokenRef.current = last.id;
      speak(last.speakText ?? last.text);
    }
  }, [last, speak]);

  const startTalking = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel(); // barge-in
    setSpeaking(false);
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = text;
      }
      setInterim(text);
    };
    rec.onerror = (e) => setMicError(e.error === "not-allowed" ? "Microphone permission denied" : e.error);
    rec.onend = () => {
      setListening(false);
      setInterim("");
      if (finalText.trim()) void assistant.send(finalText);
    };
    recRef.current = rec;
    setMicError(null);
    setListening(true);
    rec.start();
  }, [assistant, lang, ttsSupported]);

  const stopTalking = useCallback(() => recRef.current?.stop(), []);

  const state: AvatarState = opts.alert
    ? "alert"
    : listening
      ? "listening"
      : speaking
        ? "talking"
        : assistant.status === "thinking" || assistant.status === "calling_tool" || assistant.status === "answering"
          ? "thinking"
          : "idle";

  return { ...assistant, state, listening, speaking, interim, pulse, micError, sttSupported, ttsSupported,
    startTalking, stopTalking, speak };
}
