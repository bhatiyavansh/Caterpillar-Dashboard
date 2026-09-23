"use client";

import * as React from "react";
import { motion } from "motion/react";
import type { HealthStatus, MachineShape } from "@/lib/types";
import { cn, statusStyles } from "@/lib/utils";

export type MachinePart = "engine" | "hydraulics" | "tracks" | "cabin";

export const PART_INFO: Record<
  MachinePart,
  { title: string; description: string; readings: { label: string; value: string }[] }
> = {
  engine: {
    title: "Engine compartment",
    description: "CAT C4.4 ACERT · 122 kW. Tier 4 Final aftertreatment with DEF dosing.",
    readings: [
      { label: "Speed", value: "1,850 RPM" },
      { label: "Coolant", value: "84 °C" },
      { label: "Oil pressure", value: "62 PSI" },
    ],
  },
  hydraulics: {
    title: "Hydraulic system",
    description: "Boom, stick and bucket circuits fed by twin variable-displacement pumps.",
    readings: [
      { label: "System pressure", value: "3,200 PSI" },
      { label: "Oil temperature", value: "88 °C" },
      { label: "Return filter", value: "42 h to service" },
    ],
  },
  tracks: {
    title: "Undercarriage",
    description: "Sealed and lubricated track chain, 600 mm triple-grouser shoes.",
    readings: [
      { label: "Track wear", value: "38 %" },
      { label: "Track tension", value: "Nominal" },
      { label: "Travel motor", value: "71 °C" },
    ],
  },
  cabin: {
    title: "Operator station",
    description: "Alex Mercer · shift 07:00 – 15:00. Seatbelt interlock engaged.",
    readings: [
      { label: "Cab temperature", value: "22 °C" },
      { label: "Seat position", value: "Profile 2" },
      { label: "Operating time", value: "5h 42m" },
    ],
  },
};

const partFill = (active: boolean, status: HealthStatus) =>
  active ? (status === "critical" ? "#ff4d4f" : status === "warning" ? "#ffb020" : "#ffcd11") : "#3a414a";

/**
 * Stylised excavator. Deliberately illustrative rather than an engineering
 * model — its job is to let an operator point at a subsystem and read it.
 */
export function MachineVisualization({
  selected,
  onSelect,
  partStatus,
  className,
  compact,
}: {
  selected?: MachinePart | null;
  onSelect?: (part: MachinePart) => void;
  partStatus?: Partial<Record<MachinePart, HealthStatus>>;
  className?: string;
  compact?: boolean;
}) {
  const [hover, setHover] = React.useState<MachinePart | null>(null);

  const partProps = (part: MachinePart) => ({
    role: onSelect ? "button" : undefined,
    tabIndex: onSelect ? 0 : undefined,
    "aria-label": PART_INFO[part].title,
    "aria-pressed": onSelect ? selected === part : undefined,
    onClick: onSelect ? () => onSelect(part) : undefined,
    onKeyDown: onSelect
      ? (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(part);
          }
        }
      : undefined,
    onMouseEnter: () => setHover(part),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(part),
    onBlur: () => setHover(null),
    className: cn("transition-opacity", onSelect && "cursor-pointer outline-none"),
    style: { opacity: hover === part || selected === part ? 1 : 0.92 },
  });

  const glow = (part: MachinePart) =>
    hover === part || selected === part ? "url(#part-glow)" : undefined;

  const status = (part: MachinePart) => partStatus?.[part] ?? "healthy";

  return (
    <svg
      viewBox="0 0 520 300"
      className={cn("h-full w-full", className)}
      role="group"
      aria-label="Interactive excavator diagram"
    >
      <defs>
        <linearGradient id="body-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd23f" />
          <stop offset="100%" stopColor="#d9a400" />
        </linearGradient>
        <filter id="part-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#ffcd11" floodOpacity="0.55" />
        </filter>
        <pattern id="ground" width="14" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 14 L14 0" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        </pattern>
      </defs>

      {/* ground */}
      {!compact && (
        <>
          <rect x="0" y="252" width="520" height="48" fill="url(#ground)" />
          <line x1="0" y1="252" x2="520" y2="252" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
        </>
      )}

      {/* Undercarriage / tracks */}
      <g {...partProps("tracks")} filter={glow("tracks")}>
        <rect x="120" y="206" width="230" height="46" rx="23" fill="#23282f" stroke={partFill(hover === "tracks" || selected === "tracks", status("tracks"))} strokeWidth="2" />
        <circle cx="146" cy="229" r="15" fill="#31373f" />
        <circle cx="324" cy="229" r="15" fill="#31373f" />
        {[178, 208, 238, 268, 298].map((x) => (
          <circle key={x} cx={x} cy="240" r="7" fill="#31373f" />
        ))}
        {Array.from({ length: 14 }, (_, i) => (
          <rect key={i} x={122 + i * 16.4} y="244" width="12" height="7" rx="1.5" fill="#1a1e24" />
        ))}
      </g>

      {/* House / counterweight */}
      <g {...partProps("engine")} filter={glow("engine")}>
        <path d="M150 150 H330 a12 12 0 0 1 12 12 v34 a10 10 0 0 1 -10 10 H150 a10 10 0 0 1 -10 -10 v-34 a12 12 0 0 1 10 -12 z" fill="url(#body-grad)" />
        <rect x="296" y="158" width="44" height="42" rx="6" fill="#1f242b" opacity="0.85" />
        {[304, 314, 324].map((x) => (
          <rect key={x} x={x} y="164" width="4" height="30" rx="2" fill="#0d0f12" />
        ))}
        <rect x="150" y="196" width="190" height="8" fill="#0d0f12" opacity="0.35" />
        <text x="196" y="182" style={{ fontSize: 15, fontWeight: 800, fill: "#1a1a1a", letterSpacing: 1 }}>
          CAT
        </text>
      </g>

      {/* Cabin */}
      <g {...partProps("cabin")} filter={glow("cabin")}>
        <path d="M150 96 h54 a8 8 0 0 1 8 8 v46 h-70 v-46 a8 8 0 0 1 8 -8 z" fill="url(#body-grad)" />
        <path d="M156 104 h44 v34 h-44 z" fill="#5fa8d3" opacity="0.5" />
        <path d="M156 104 l44 34" stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
        <rect x="140" y="146" width="72" height="6" fill="#0d0f12" opacity="0.4" />
      </g>

      {/* Boom / stick / bucket — hydraulics */}
      <g {...partProps("hydraulics")} filter={glow("hydraulics")}>
        <path d="M214 150 L318 96 L352 118 L246 176 Z" fill="url(#body-grad)" transform="translate(0,0)" />
        <path d="M344 112 L430 176 L412 196 L328 132 Z" fill="url(#body-grad)" />
        <path d="M404 192 q26 22 46 6 l-6 26 q-26 12 -50 -14 z" fill="#c99a00" />
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M${442 + i * 6} ${210 + i * 2} l8 10 l-10 0 z`} fill="#8a6b00" />
        ))}
        {/* cylinders */}
        <rect x="248" y="122" width="76" height="12" rx="6" fill="#2b3139" transform="rotate(-27 248 122)" />
        <rect x="352" y="146" width="62" height="10" rx="5" fill="#2b3139" transform="rotate(37 352 146)" />
        <motion.circle
          cx="344"
          cy="112"
          r="6"
          fill={partFill(hover === "hydraulics" || selected === "hydraulics", status("hydraulics"))}
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        />
      </g>

      {/* status pips */}
      {(["engine", "hydraulics", "tracks", "cabin"] as MachinePart[]).map((part) => {
        const pos = { engine: [268, 150], hydraulics: [386, 150], tracks: [235, 262], cabin: [176, 88] }[part];
        const st = status(part);
        if (st === "healthy") return null;
        return (
          <g key={part} pointerEvents="none">
            <circle cx={pos[0]} cy={pos[1]} r="9" fill={st === "critical" ? "#ff4d4f" : "#ffb020"} opacity="0.9" />
            <text x={pos[0]} y={pos[1] + 4} textAnchor="middle" style={{ fontSize: 12, fontWeight: 800, fill: "#0a0b0d" }}>
              !
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Small silhouettes used in fleet cards and inspection steps. */
export function MachineSilhouette({
  shape,
  className,
  status = "healthy",
}: {
  shape: MachineShape | "fluids" | "safety";
  className?: string;
  status?: HealthStatus;
}) {
  const accent = statusStyles[status].text;
  const paths: Record<string, React.ReactNode> = {
    excavator: (
      <>
        <rect x="14" y="52" width="60" height="14" rx="7" fill="currentColor" opacity="0.35" />
        <path d="M20 36 h38 a6 6 0 0 1 6 6 v10 H20 z" fill="currentColor" />
        <path d="M22 18 h18 v18 H22 z" fill="currentColor" opacity="0.7" />
        <path d="M62 44 L88 20 l8 8 L70 52 z" fill="currentColor" />
        <path d="M90 26 q10 10 18 2 l-2 14 q-12 6 -22 -6 z" fill="currentColor" opacity="0.8" />
      </>
    ),
    loader: (
      <>
        <circle cx="30" cy="58" r="12" fill="currentColor" opacity="0.4" />
        <circle cx="72" cy="58" r="12" fill="currentColor" opacity="0.4" />
        <path d="M22 34 h56 a6 6 0 0 1 6 6 v14 H22 z" fill="currentColor" />
        <path d="M48 16 h22 v18 H48 z" fill="currentColor" opacity="0.7" />
        <path d="M22 40 L6 30 v22 l16 -6 z" fill="currentColor" opacity="0.85" />
      </>
    ),
    dozer: (
      <>
        <rect x="24" y="50" width="62" height="16" rx="8" fill="currentColor" opacity="0.35" />
        <path d="M34 30 h44 a6 6 0 0 1 6 6 v14 H34 z" fill="currentColor" />
        <path d="M52 14 h22 v16 H52 z" fill="currentColor" opacity="0.7" />
        <path d="M18 30 h8 v38 h-8 z" fill="currentColor" opacity="0.85" />
      </>
    ),
    compactor: (
      <>
        <circle cx="34" cy="52" r="18" fill="currentColor" opacity="0.4" />
        <circle cx="82" cy="56" r="12" fill="currentColor" opacity="0.4" />
        <path d="M44 30 h44 a6 6 0 0 1 6 6 v14 H44 z" fill="currentColor" />
        <path d="M56 12 h22 v18 H56 z" fill="currentColor" opacity="0.7" />
      </>
    ),
    fluids: (
      <>
        <path d="M46 14 q22 26 22 38 a22 22 0 1 1 -44 0 q0 -12 22 -38 z" fill="currentColor" opacity="0.8" />
        <rect x="76" y="30" width="26" height="36" rx="4" fill="currentColor" opacity="0.5" />
      </>
    ),
    safety: (
      <>
        <path d="M58 12 l32 12 v20 q0 24 -32 34 q-32 -10 -32 -34 v-20 z" fill="currentColor" opacity="0.8" />
        <path d="M44 44 l10 10 l20 -20" stroke="#0a0b0d" strokeWidth="6" fill="none" strokeLinecap="round" />
      </>
    ),
  };

  return (
    <svg viewBox="0 0 120 80" className={cn("h-full w-full", accent, className)} aria-hidden>
      {paths[shape]}
    </svg>
  );
}
