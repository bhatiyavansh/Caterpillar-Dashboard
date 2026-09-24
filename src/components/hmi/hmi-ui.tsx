"use client";

/**
 * Visual system for the in-cab display.
 *
 * Modelled on current premium vehicle interfaces: the live machine is the
 * hero, and the interface floats over it on frosted glass. Numbers are large
 * and light, labels small and quiet, and colour is rationed: CAT yellow for
 * "selected" and "primary", status colours only when something needs you.
 */
import * as React from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export const C = {
  text: "#F2F5F8",
  muted: "#8E98A6",
  dim: "#566070",
  accent: "#FFC72C",
  cyan: "#62D0FF",
  ok: "#3DDC97",
  warn: "#FFB547",
  crit: "#FF5A67",
  track: "rgba(255,255,255,0.08)",
} as const;

export const glass = "border border-white/7 bg-[#0d1016]/75 backdrop-blur-xl";

export function Card({ title, action, className, children, pad = true }: { title?: string; action?: React.ReactNode; className?: string; children: React.ReactNode; pad?: boolean }) {
  return (
    <section className={cn("rounded-2xl border border-white/6 bg-white/3", className)}>
      {title ? (
        <header className="flex items-center justify-between px-5 pt-4">
          <h3 className="text-[13px] font-medium tracking-wide text-[#8E98A6]">{title}</h3>
          {action}
        </header>
      ) : null}
      <div className={cn(pad && "p-5", title && pad && "pt-3")}>{children}</div>
    </section>
  );
}

/** A number that eases to its new value instead of jumping. */
export function Num({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => v.toFixed(decimals));
  React.useEffect(() => {
    const c = animate(mv, value, { duration: 0.45, ease: "easeOut" });
    return () => c.stop();
  }, [mv, value]);
  return <motion.span className={cn("tabular-nums", className)}>{text}</motion.span>;
}

export function Stat({
  label,
  value,
  unit,
  tone,
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  tone?: "ok" | "warn" | "crit" | "accent";
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const color = tone ? { ok: C.ok, warn: C.warn, crit: C.crit, accent: C.accent }[tone] : C.text;
  const text = { sm: "text-[20px]", md: "text-[28px]", lg: "text-[40px]", xl: "text-[64px] leading-none" }[size];
  return (
    <div>
      <p className="text-[12px] font-medium tracking-wide text-[#8E98A6]">{label}</p>
      <p className={cn("mt-1 font-light tabular-nums tracking-tight", text)} style={{ color }}>
        {value}
        {unit ? <span className="ml-1 text-[0.42em] font-normal text-[#8E98A6]">{unit}</span> : null}
      </p>
    </div>
  );
}

export function Button({
  children,
  icon: Icon,
  variant = "default",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: LucideIcon; variant?: "default" | "primary" | "danger" | "selected" | "ghost" }) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-medium transition-all active:scale-[0.97] disabled:pointer-events-none disabled:opacity-35",
        variant === "primary" && "bg-[#FFC72C] text-[#14110a] shadow-[0_8px_24px_-10px_rgba(255,199,44,0.7)] hover:bg-[#ffd257]",
        variant === "danger" && "bg-[#FF5A67] text-white hover:bg-[#ff6f7a]",
        variant === "selected" && "bg-[#FFC72C]/15 text-[#FFC72C] ring-1 ring-inset ring-[#FFC72C]/60",
        variant === "default" && "bg-white/6 text-[#E6EAF0] hover:bg-white/[0.1]",
        variant === "ghost" && "text-[#8E98A6] hover:bg-white/5 hover:text-white",
        className,
      )}
    >
      {Icon ? <Icon className="size-[18px] shrink-0" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Meter({ value, tone = "accent", className }: { value: number; tone?: "accent" | "ok" | "warn" | "crit" | "cyan"; className?: string }) {
  const fill = { accent: C.accent, ok: C.ok, warn: C.warn, crit: C.crit, cyan: C.cyan }[tone];
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-white/8", className)}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: fill }}
        initial={false}
        animate={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
      />
    </div>
  );
}

export function Dot({ tone, pulse }: { tone: "ok" | "warn" | "crit" | "off" | "cyan"; pulse?: boolean }) {
  const c = { ok: C.ok, warn: C.warn, crit: C.crit, off: "#3a4250", cyan: C.cyan }[tone];
  return (
    <span className="relative inline-flex size-2 shrink-0">
      {pulse ? <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: c }} /> : null}
      <span className="relative inline-flex size-2 rounded-full" style={{ background: c }} />
    </span>
  );
}

/** Semicircular arc gauge with an eased sweep. */
export function ArcGauge({ value, max, size = 220, stroke = 10, color = C.accent, children }: { value: number; max: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const len = Math.PI * r;
  const frac = Math.max(0, Math.min(1, value / max));
  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);
  return (
    <div className="relative" style={{ width: size, height: size / 2 + stroke }}>
      <svg width={size} height={size / 2 + stroke} className="overflow-visible">
        {ticks.map((f) => {
          const a = Math.PI * (1 - f);
          const x1 = size / 2 + Math.cos(a) * (r - stroke - 4);
          const y1 = size / 2 - Math.sin(a) * (r - stroke - 4);
          const x2 = size / 2 + Math.cos(a) * (r - stroke - (f * 10 % 5 === 0 ? 12 : 8));
          const y2 = size / 2 - Math.sin(a) * (r - stroke - (f * 10 % 5 === 0 ? 12 : 8));
          return <line key={f} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.18)" strokeWidth={1.5} />;
        })}
        <path d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`} fill="none" stroke={C.track} strokeWidth={stroke} strokeLinecap="round" />
        <motion.path
          d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={len}
          initial={false}
          animate={{ strokeDashoffset: len * (1 - frac) }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
          style={{ filter: `drop-shadow(0 0 10px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">{children}</div>
    </div>
  );
}

/** Circular progress ring. */
export function Ring({ value, size = 64, stroke = 6, color = C.accent, children }: { value: number; size?: number; stroke?: number; color?: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - Math.max(0, Math.min(1, value))) }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function SheetTitle({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[30px] font-light tracking-tight text-white">{title}</h2>
        {detail ? <p className="mt-1 text-[14px] text-[#8E98A6]">{detail}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] font-medium tracking-wide text-[#8E98A6]">{children}</p>;
}

export function fmtMin(min: number) {
  const m = Math.max(0, Math.round(min));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m} min`;
}
