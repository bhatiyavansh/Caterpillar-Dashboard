"use client";
/**
 * Avatar2D: the site-crew character that fronts the assistant. Same state names as D's AvatarSlot.
 *
 * Each state reads at a glance, even at the 28 px the dock draws it:
 *   idle       calm grey ring, slow blink
 *   listening  blue ring with ripples, eyes forward, brows up
 *   thinking   yellow arc sweeping the ring, eyes up and to the side
 *   talking    yellow ring that breathes with each word, mouth lip-synced
 *   alert      red ring pulsing, brows down, warning badge
 *
 * Lip sync is procedural: `pulse` increments on every spoken word (browser TTS exposes no audio stream).
 */
import { useId } from "react";
import type { AvatarState } from "../../lib/voice/useVoice";

const TONE: Record<AvatarState, string> = {
  idle: "#6b7280", listening: "#4aa8ff", thinking: "#ffcd11", talking: "#ffcd11", alert: "#ff4d4f",
};

const LABEL: Record<AvatarState, string> = {
  idle: "Ready", listening: "Listening", thinking: "Thinking", talking: "Speaking", alert: "Alert",
};

const CSS = `
.av-blink { transform-box: fill-box; transform-origin: center; animation: av-blink 4.5s infinite; }
@keyframes av-blink { 0%, 94%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
.av-spin { transform-origin: 50px 50px; animation: av-spin 1.1s linear infinite; }
@keyframes av-spin { to { transform: rotate(360deg); } }
.av-ripple { transform-origin: 50px 50px; animation: av-ripple 1.6s ease-out infinite; }
@keyframes av-ripple { from { transform: scale(0.9); opacity: .7; } to { transform: scale(1.12); opacity: 0; } }
.av-throb { animation: av-throb 0.9s ease-in-out infinite; }
@keyframes av-throb { 50% { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .av-blink, .av-spin, .av-ripple, .av-throb { animation: none; } }
`;

export function Avatar2D({ state, pulse = 0, size = 96, label = true }: {
  state: AvatarState; pulse?: number; size?: number; label?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const tone = TONE[state];
  const talking = state === "talking";
  // Small sizes drop the fine detail that would only turn to noise.
  const detailed = size >= 44;

  // Eyes follow the state: up and aside while thinking, wide while listening.
  const look = state === "thinking" ? { x: 2.2, y: -2 } : { x: 0, y: 0 };
  const eyeR = state === "listening" ? 3 : 2.6;
  const brow = state === "alert" ? 3 : state === "listening" ? -2 : state === "thinking" ? -1 : 0;
  const mouthOpen = talking ? (pulse % 3 === 0 ? 5.5 : pulse % 3 === 1 ? 2.5 : 4) : state === "alert" ? 3 : 0;

  return (
    <div className="inline-flex flex-col items-center gap-1.5" role="img" aria-label={`Assistant: ${LABEL[state]}`}>
      <svg width={size} height={size} viewBox="0 0 100 100" className="overflow-visible">
        <defs>
          <radialGradient id={`${id}-bg`} cx="50%" cy="35%" r="70%">
            <stop offset="0%" stopColor="#242c39" />
            <stop offset="100%" stopColor="#0e1219" />
          </radialGradient>
          <linearGradient id={`${id}-hat`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffe066" />
            <stop offset="100%" stopColor="#f2b705" />
          </linearGradient>
          <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0c7a0" />
            <stop offset="100%" stopColor="#d9a47a" />
          </linearGradient>
          <clipPath id={`${id}-disc`}>
            <circle cx="50" cy="50" r="44" />
          </clipPath>
          <filter id={`${id}-glow`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
        </defs>
        <style>{CSS}</style>

        {/* Glow behind the ring for the active states */}
        {state !== "idle" ? (
          <circle cx="50" cy="50" r="46" fill="none" stroke={tone} strokeWidth="5" filter={`url(#${id}-glow)`}
            opacity={talking ? 0.35 + (pulse % 2) * 0.35 : 0.45} className={state === "alert" ? "av-throb" : undefined}
            style={{ transition: "opacity 120ms linear" }} />
        ) : null}

        {/* Listening ripples */}
        {state === "listening" ? (
          <>
            <circle cx="50" cy="50" r="46" fill="none" stroke={tone} strokeWidth="2" className="av-ripple" />
            <circle cx="50" cy="50" r="46" fill="none" stroke={tone} strokeWidth="2" className="av-ripple" style={{ animationDelay: "0.8s" }} />
          </>
        ) : null}

        {/* Disc and ring */}
        <circle cx="50" cy="50" r="46" fill={`url(#${id}-bg)`} />
        <circle cx="50" cy="50" r="46" fill="none" stroke={tone} strokeWidth={state === "idle" ? 2 : 3}
          opacity={state === "idle" ? 0.7 : 1} className={state === "alert" ? "av-throb" : undefined} />
        {state === "thinking" ? (
          <circle cx="50" cy="50" r="46" fill="none" stroke="#fff5cc" strokeWidth="3.5" strokeLinecap="round"
            strokeDasharray="48 241" className="av-spin" />
        ) : null}

        <g clipPath={`url(#${id}-disc)`}>
          {/* Hi-vis vest */}
          <path d="M14 104 Q16 80 36 76 L64 76 Q84 80 86 104 Z" fill="#ff8a1f" />
          <path d="M42 76 L50 90 L58 76 Z" fill="#2a303a" />
          {detailed ? (
            <>
              <rect x="14" y="88" width="72" height="4" fill="#e9edf2" opacity="0.85" />
              <rect x="30" y="76" width="4" height="30" fill="#e9edf2" opacity="0.85" />
              <rect x="66" y="76" width="4" height="30" fill="#e9edf2" opacity="0.85" />
            </>
          ) : null}
          {/* Neck */}
          <rect x="44" y="66" width="12" height="12" rx="3" fill="#cf9a70" />
        </g>

        {/* Head */}
        <ellipse cx="30.5" cy="55" rx="3.5" ry="5" fill="#d9a47a" />
        <ellipse cx="69.5" cy="55" rx="3.5" ry="5" fill="#d9a47a" />
        <ellipse cx="50" cy="54" rx="19" ry="20" fill={`url(#${id}-skin)`} />

        {/* Brows */}
        <g stroke="#3b2a20" strokeWidth="2.2" strokeLinecap="round" style={{ transition: "transform 200ms ease" }}>
          <path d={`M37 ${47 + brow} L45 ${47 - (state === "alert" ? -1.5 : 0.5)}`} />
          <path d={`M55 ${47 - (state === "alert" ? -1.5 : state === "thinking" ? 2 : 0.5)} L63 ${47 + brow}`} />
        </g>

        {/* Eyes */}
        <g className={state === "idle" || state === "talking" ? "av-blink" : undefined}>
          <circle cx={41 + look.x} cy={54 + look.y} r={eyeR} fill="#14171c" style={{ transition: "all 200ms ease" }} />
          <circle cx={59 + look.x} cy={54 + look.y} r={eyeR} fill="#14171c" style={{ transition: "all 200ms ease" }} />
          {detailed ? (
            <>
              <circle cx={42 + look.x} cy={53 + look.y} r="0.9" fill="#fff" />
              <circle cx={60 + look.x} cy={53 + look.y} r="0.9" fill="#fff" />
            </>
          ) : null}
        </g>

        {/* Mouth */}
        {mouthOpen > 0 ? (
          <ellipse cx="50" cy="65" rx={state === "alert" ? 4 : 5.5} ry={mouthOpen} fill="#6b2d2d" style={{ transition: "ry 90ms linear" }} />
        ) : state === "thinking" ? (
          <path d="M45 65 L55 64" stroke="#6b2d2d" strokeWidth="2.2" strokeLinecap="round" />
        ) : (
          <path d="M43.5 63.5 Q50 69 56.5 63.5" fill="none" stroke="#6b2d2d" strokeWidth="2.2" strokeLinecap="round" />
        )}

        {/* Hard hat */}
        <path d="M28 44 Q28 22 50 20 Q72 22 72 44 Z" fill={`url(#${id}-hat)`} stroke="#1a1a1a" strokeWidth="1.2" />
        <path d="M50 20 L50 44" stroke="#d9a000" strokeWidth="3" opacity="0.7" />
        <path d="M22 45 Q50 38 78 45 L78 47.5 Q50 42 22 47.5 Z" fill="#f2b705" stroke="#1a1a1a" strokeWidth="1.2" />
        {detailed ? (
          <>
            <rect x="37" y="30" width="26" height="8" rx="1.5" fill="#14171c" />
            <text x="50" y="36.4" textAnchor="middle" fontSize="6.5" fontWeight="900" fill="#ffcd11" letterSpacing="0.6">CAT</text>
          </>
        ) : null}

        {/* Alert badge */}
        {state === "alert" ? (
          <g className="av-throb">
            <circle cx="81" cy="19" r="10" fill="#ff4d4f" stroke="#0e1219" strokeWidth="2" />
            <rect x="79.6" y="12.5" width="2.8" height="8" rx="1.2" fill="#fff" />
            <circle cx="81" cy="24" r="1.6" fill="#fff" />
          </g>
        ) : null}
      </svg>
      {label ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
          style={{ color: tone, borderColor: `${tone}55`, background: `${tone}14` }}>
          <span className="size-1.5 rounded-full" style={{ background: tone }} />
          {LABEL[state]}
        </span>
      ) : null}
    </div>
  );
}
