"use client";
/**
 * Avatar2D: lightweight SVG site-crew character (CAT hard hat). Same state names as D's AvatarSlot.
 * Lip sync is procedural: `pulse` increments on every spoken word (browser TTS exposes no audio stream).
 */
import type { AvatarState } from "../../lib/voice/useVoice";

const RING: Record<AvatarState, string> = {
  idle: "#9aa3ad", listening: "#4aa8ff", thinking: "#ffcd11", talking: "#ffcd11", alert: "#ff4d4f",
};

export function Avatar2D({ state, pulse = 0, size = 96, label = true }: {
  state: AvatarState; pulse?: number; size?: number; label?: boolean;
}) {
  const open = state === "talking" ? (pulse % 2 === 0 ? 7 : 2) : state === "alert" ? 5 : 1.5;
  return (
    <div className="inline-flex flex-col items-center gap-1" role="img" aria-label={`Copilot is ${state}`}>
      <svg width={size} height={size} viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="47" fill="#14171c" stroke={RING[state]} strokeWidth="4"
          className={state === "listening" || state === "alert" ? "animate-pulse" : undefined} />
        <circle cx="50" cy="58" r="24" fill="#e7b98f" />
        <path d="M24 50 Q26 24 50 22 Q74 24 76 50 Z" fill="#ffcd11" stroke="#0a0b0d" strokeWidth="1.5" />
        <rect x="20" y="48" width="60" height="6" rx="3" fill="#ffcd11" stroke="#0a0b0d" strokeWidth="1.5" />
        <text x="50" y="42" textAnchor="middle" fontSize="9" fontWeight="800" fill="#0a0b0d">CAT</text>
        <circle cx="41" cy="60" r="2.6" fill="#0a0b0d" />
        <circle cx="59" cy="60" r="2.6" fill="#0a0b0d" />
        {state === "thinking" && <circle cx="72" cy="30" r="3" fill="#ffcd11" className="animate-ping" />}
        <ellipse cx="50" cy="71" rx="7" ry={open} fill="#5a2a2a" style={{ transition: "ry 80ms linear" }} />
      </svg>
      {label && <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: RING[state] }}>{state}</span>}
    </div>
  );
}
