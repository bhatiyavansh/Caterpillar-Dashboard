"use client";

import { motion } from "motion/react";
import type { HealthStatus } from "@/lib/types";
import { cn, statusStyles } from "@/lib/utils";

const ARC_START = 135;
const ARC_SWEEP = 270;

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polar(cx, cy, r, endDeg);
  const end = polar(cx, cy, r, startDeg);
  const large = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 0 ${end.x} ${end.y}`;
}

const statusStroke: Record<HealthStatus, string> = {
  healthy: "var(--color-status-ok)",
  warning: "var(--color-status-warn)",
  critical: "var(--color-status-crit)",
  offline: "#6b7280",
};

/**
 * Round analogue-style gauge sized for gloved touch input. Values animate
 * towards their target rather than snapping, so a glance reads as movement.
 */
export function SensorGauge({
  label,
  value,
  min,
  max,
  unit,
  status = "healthy",
  size = 180,
  decimals = 0,
  redlineFrom,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  status?: HealthStatus;
  size?: number;
  decimals?: number;
  redlineFrom?: number;
  className?: string;
}) {
  const cx = 100;
  const cy = 100;
  const r = 78;
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const endDeg = ARC_START + ratio * ARC_SWEEP;
  const s = statusStyles[status];

  const ticks = Array.from({ length: 9 }, (_, i) => ARC_START + (i / 8) * ARC_SWEEP);

  return (
    <div className={cn("flex flex-col items-center", className)}>
      <svg
        viewBox="0 0 200 200"
        width={size}
        height={size}
        role="img"
        aria-label={`${label}: ${value.toFixed(decimals)} ${unit}, ${statusStyles[status].label}`}
      >
        <circle cx={cx} cy={cy} r={92} fill="#101216" stroke="rgba(255,255,255,0.08)" />
        <path d={arcPath(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP)} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={12} strokeLinecap="round" />
        {redlineFrom !== undefined ? (
          <path
            d={arcPath(
              cx,
              cy,
              r,
              ARC_START + ((redlineFrom - min) / (max - min)) * ARC_SWEEP,
              ARC_START + ARC_SWEEP,
            )}
            fill="none"
            stroke="rgba(255,77,79,0.35)"
            strokeWidth={12}
            strokeLinecap="round"
          />
        ) : null}
        <motion.path
          d={arcPath(cx, cy, r, ARC_START, Math.max(ARC_START + 0.5, endDeg))}
          fill="none"
          stroke={statusStroke[status]}
          strokeWidth={12}
          strokeLinecap="round"
          initial={false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        />
        {ticks.map((deg, i) => {
          const outer = polar(cx, cy, r - 12, deg);
          const inner = polar(cx, cy, r - 20, deg);
          return (
            <line
              key={i}
              x1={outer.x}
              y1={outer.y}
              x2={inner.x}
              y2={inner.y}
              stroke="rgba(255,255,255,0.28)"
              strokeWidth={2}
            />
          );
        })}
        <motion.line
          x1={cx}
          y1={cy}
          x2={polar(cx, cy, r - 24, endDeg).x}
          y2={polar(cx, cy, r - 24, endDeg).y}
          stroke="var(--color-cat-500)"
          strokeWidth={3}
          strokeLinecap="round"
          initial={false}
          animate={{
            x2: polar(cx, cy, r - 24, endDeg).x,
            y2: polar(cx, cy, r - 24, endDeg).y,
          }}
          transition={{ type: "spring", stiffness: 60, damping: 14 }}
        />
        <circle cx={cx} cy={cy} r={7} fill="#23282f" stroke="rgba(255,255,255,0.25)" />
        <text x={cx} y={cy + 38} textAnchor="middle" className="fill-zinc-100" style={{ fontSize: 30, fontWeight: 700 }}>
          {value.toFixed(decimals)}
        </text>
        <text x={cx} y={cy + 56} textAnchor="middle" style={{ fontSize: 13, fill: "#9aa3ad", letterSpacing: 1 }}>
          {unit}
        </text>
      </svg>
      <div className="mt-1 text-center">
        <p className="label-xs">{label}</p>
        <p className={cn("text-xs font-semibold tracking-widest", s.text)}>{s.label}</p>
      </div>
    </div>
  );
}

/** Compact horizontal bar gauge for secondary readings. */
export function BarGauge({
  label,
  value,
  max,
  unit,
  status = "healthy",
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  status?: HealthStatus;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const s = statusStyles[status];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-xs">{label}</span>
        <span className={cn("font-mono text-sm font-semibold", s.text)}>
          {value.toFixed(0)}
          <span className="ml-1 text-[11px] text-muted">{unit}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <motion.div
          className={cn("h-full rounded-full", s.dot)}
          initial={false}
          animate={{ width: pct + "%" }}
          transition={{ type: "spring", stiffness: 80, damping: 18 }}
        />
      </div>
    </div>
  );
}
