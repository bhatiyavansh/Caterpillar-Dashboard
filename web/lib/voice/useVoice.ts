"use client";
/**
 * useVoice: free voice for the assistant, in any browser.
 *   speech-to-text, push-to-talk:
 *     1. "server": record with MediaRecorder, send to the hub's POST /api/stt (Groq Whisper, free tier).
 *        Works in every browser (Brave/Arc/Safari too) and detects Hindi, Tamil... automatically.
 *     2. "browser": Web Speech API. Used when the hub has no STT key, or MediaRecorder is missing.
 *        Chrome's version sends audio to Google and fails with "network" in Brave/Arc/offline - on that
 *        error we switch to "server" for the next press.
 *   text-to-speech: speechSynthesis (browser voices). Each sentence is spoken in the voice of its own
 *   script, so a Hindi answer followed by English protocol steps sounds right. Talking again interrupts.
 * "confirm" / "cancel" while an action is pending are resolved locally by useAssistant (never the LLM).
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { assistantApiBase } from "../assistant/client";
import { useAssistant, type UseAssistantOptions } from "../assistant/hooks";

export type AvatarState = "idle" | "listening" | "thinking" | "talking" | "alert"; // same names as D's AvatarSlot

/** "auto" lets Whisper detect the language; otherwise a BCP-47 tag like "hi-IN". */
export type VoiceLang = "auto" | string;

export const VOICE_LANGS: { id: VoiceLang; label: string }[] = [
  { id: "auto", label: "Auto-detect" },
  { id: "en-IN", label: "English" },
  { id: "hi-IN", label: "हिन्दी Hindi" },
  { id: "ta-IN", label: "தமிழ் Tamil" },
  { id: "te-IN", label: "తెలుగు Telugu" },
  { id: "kn-IN", label: "ಕನ್ನಡ Kannada" },
  { id: "mr-IN", label: "मराठी Marathi" },
  { id: "bn-IN", label: "বাংলা Bengali" },
];

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

const canRecord = () =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

/**
 * Browser capabilities, read hydration-safely: the server snapshot says "no", the client's first
 * (hydrating) render agrees, and the real value lands right after. So this hook can live in a
 * provider at the root of the app without a server/client mismatch.
 */
const noSubscribe = () => () => {};
function useCapability(read: () => boolean): boolean {
  return useSyncExternalStore(noSubscribe, read, () => false);
}
const readCanRecord = () => canRecord();
const readCanRecognise = () => recognitionCtor() !== null;
const readCanSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Language of a piece of text from its script (Latin -> English). */
export function scriptLang(text: string): string {
  if (/[ऀ-ॿ]/.test(text)) return "hi-IN"; // Devanagari (Hindi, Marathi)
  if (/[஀-௿]/.test(text)) return "ta-IN";
  if (/[ఀ-౿]/.test(text)) return "te-IN";
  if (/[ಀ-೿]/.test(text)) return "kn-IN";
  if (/[ঀ-৿]/.test(text)) return "bn-IN";
  return "en-IN";
}

/** Split into speakable chunks that each stay in one script. Markdown symbols are never read aloud. */
export function speechChunks(text: string): { text: string; lang: string }[] {
  const plain = text.replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "");
  const parts = plain.split(/(?<=[.!?।])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const out: { text: string; lang: string }[] = [];
  for (const p of parts) {
    const lang = scriptLang(p);
    const prev = out[out.length - 1];
    if (prev && prev.lang === lang) prev.text += " " + p;
    else out.push({ text: p, lang });
  }
  return out;
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0];
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.startsWith(base));
}

export interface UseVoiceOptions extends UseAssistantOptions {
  /** True while a safety alert is active for this surface (drives the avatar's alert state). */
  alert?: boolean;
  /** Spoken language; "auto" (default) detects it from the speech. */
  lang?: VoiceLang;
  apiBase?: string;
}

export function useVoice(opts: UseVoiceOptions) {
  const assistant = useAssistant(opts);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [pulse, setPulse] = useState(0); // increments on each spoken word: procedural lip sync
  const [micError, setMicError] = useState<string | null>(null);
  const recordable = useCapability(readCanRecord);
  const recognisable = useCapability(readCanRecognise);
  // null = follow the browser's capabilities; set when one engine fails and we switch to the other
  const [engineOverride, setEngine] = useState<"server" | "browser" | null>(null);
  const engine = engineOverride ?? (recordable ? "server" : "browser");
  const recRef = useRef<Recognition | null>(null);
  const mediaRef = useRef<{ rec: MediaRecorder; stream: MediaStream } | null>(null);
  const holdingRef = useRef(false);
  const spokenRef = useRef<string | null>(null);
  const sttSupported = recordable || recognisable;
  const ttsSupported = useCapability(readCanSpeak);
  const lang = opts.lang ?? "auto";
  const apiBase = opts.apiBase ?? assistantApiBase();
  const { send } = assistant;

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || !text) return;
      window.speechSynthesis.cancel();
      const chunks = speechChunks(text);
      chunks.forEach((c, i) => {
        const u = new SpeechSynthesisUtterance(c.text);
        u.lang = c.lang;
        const v = pickVoice(c.lang);
        if (v) u.voice = v;
        u.rate = 1.02;
        if (i === 0) u.onstart = () => setSpeaking(true);
        if (i === chunks.length - 1) u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        u.onboundary = () => setPulse((p) => p + 1);
        window.speechSynthesis.speak(u);
      });
    },
    [ttsSupported],
  );

  // speak each new assistant answer once (external side effect only; no state set here)
  const last = assistant.messages[assistant.messages.length - 1];
  useEffect(() => {
    if (last && last.role === "assistant" && spokenRef.current !== last.id) {
      spokenRef.current = last.id;
      speak(last.speakText ?? last.text);
    }
  }, [last, speak]);

  const transcribe = useCallback(
    async (blob: Blob) => {
      setTranscribing(true);
      setInterim("Transcribing…");
      try {
        const q = lang === "auto" ? "" : `?lang=${encodeURIComponent(lang)}`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15_000);
        const r = await fetch(`${apiBase}/api/stt${q}`, {
          method: "POST",
          body: blob,
          headers: { "content-type": blob.type || "audio/webm" },
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
        if (r.status === 503 && recognitionCtor()) {
          setEngine("browser"); // hub has no STT key: use the browser's recogniser from now on
          setMicError("Server speech-to-text unavailable; switched to the browser's. Hold to talk again.");
          return;
        }
        if (!r.ok) throw new Error(`speech-to-text failed (${r.status})`);
        const { text } = (await r.json()) as { text: string; language?: string };
        if (text?.trim()) void send(text.trim());
        else setMicError("Didn't catch that. Hold the button while you speak.");
      } catch (e) {
        setMicError(e instanceof Error && e.name === "AbortError" ? "Speech-to-text timed out; try again or type." : String(e));
      } finally {
        setTranscribing(false);
        setInterim("");
      }
    },
    [apiBase, lang, send],
  );

  const startServer = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setListening(false);
      setMicError(e instanceof Error && e.name === "NotAllowedError" ? "Microphone permission denied" : "No microphone found");
      return;
    }
    if (!holdingRef.current) { // released before the mic opened
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false);
      const blob = new Blob(parts, { type: (rec.mimeType || "audio/webm").split(";")[0] });
      if (blob.size > 1500) void transcribe(blob); // < ~0.2 s: an accidental tap
    };
    mediaRef.current = { rec, stream };
    rec.start();
  }, [transcribe]);

  const startBrowser = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang === "auto" ? "en-IN" : lang;
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
    rec.onerror = (e) => {
      if (e.error === "network" && canRecord()) {
        setEngine("server"); // this browser can't reach Google's recogniser: record + /api/stt instead
        setMicError("Browser speech recognition can't connect; switched to server speech-to-text. Hold to talk again.");
      } else setMicError(e.error === "not-allowed" ? "Microphone permission denied" : e.error);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      if (finalText.trim()) void send(finalText);
    };
    recRef.current = rec;
    rec.start();
  }, [lang, send]);

  const startTalking = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel(); // barge-in
    setSpeaking(false);
    setMicError(null);
    holdingRef.current = true;
    setListening(true);
    if (engine === "server") void startServer();
    else startBrowser();
  }, [engine, startBrowser, startServer, ttsSupported]);

  const stopTalking = useCallback(() => {
    holdingRef.current = false;
    const m = mediaRef.current;
    if (m && m.rec.state !== "inactive") m.rec.stop();
    mediaRef.current = null;
    recRef.current?.stop();
    recRef.current = null;
  }, []);

  const state: AvatarState = opts.alert
    ? "alert"
    : listening
      ? "listening"
      : speaking
        ? "talking"
        : transcribing || assistant.status === "thinking" || assistant.status === "calling_tool" || assistant.status === "answering"
          ? "thinking"
          : "idle";

  const stopSpeaking = useCallback(() => {
    if (ttsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [ttsSupported]);

  return { ...assistant, state, listening, transcribing, speaking, interim, pulse, micError, sttSupported, ttsSupported,
    sttEngine: engine, startTalking, stopTalking, speak, stopSpeaking };
}
