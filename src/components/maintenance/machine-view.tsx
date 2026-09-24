"use client";

/**
 * Machine view for the breakdown workspace.
 *
 * Today this is a live hydraulic schematic: the tank level, flow and the failed
 * hose all follow the simulated telemetry. It is deliberately a slot: a 3D
 * model can replace it later by honouring the same props (which parts to
 * highlight, which one failed, what is selected), and nothing around it has to
 * change.
 */
import * as React from "react";
import { PARTS, type PartId } from "@/lib/maintenance/hydraulic-leak";
import { cn } from "@/lib/utils";

/**
 * ok        healthy, or not yet known to be faulty
 * leaking   split and spraying: engine running with the hose open
 * failed    split, engine off: nothing flowing out, still broken
 * removed   taken off, ports capped
 * replaced  new hose fitted
 */
export type HoseState = "ok" | "leaking" | "failed" | "removed" | "replaced";

export interface MachineViewProps {
  /** Tank sight-glass level, %. */
  level: number;
  pressure: number;
  engineOn: boolean;
  hose: HoseState;
  /** Oil on the ground under the boom foot. */
  spill: boolean;
  /** Parts the current step or cause touches. */
  highlight: PartId[];
  selected: PartId | null;
  onSelect: (id: PartId) => void;
}

const COLORS = {
  line: "#4b5563",
  flow: "#ffcd11",
  body: "#19202b",
  stroke: "#6b7280",
  crit: "#ff4d4f",
  ok: "#3ddc84",
  oil: "#b88a1b",
};

function Part({
  id,
  selected,
  highlighted,
  onSelect,
  children,
}: {
  id: PartId;
  selected: boolean;
  highlighted: boolean;
  onSelect: (id: PartId) => void;
  children: React.ReactNode;
}) {
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={PARTS[id].name}
      aria-pressed={selected}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(id))}
      className={cn("cursor-pointer outline-none [&:focus-visible]:opacity-80", highlighted && "hs-highlight")}
    >
      {children}
    </g>
  );
}

function Cylinder({ y, label, stroke }: { y: number; label: string; stroke: string }) {
  return (
    <>
      <rect x={400} y={y} width={100} height={24} rx={4} fill={COLORS.body} stroke={stroke} strokeWidth={2} />
      <rect x={500} y={y + 8} width={40} height={8} rx={2} fill="#9aa3ad" />
      <text x={450} y={y + 16} textAnchor="middle" className="fill-zinc-300 text-[10px] font-semibold">
        {label}
      </text>
    </>
  );
}

export function MachineView({ level, pressure, engineOn, hose, spill, highlight, selected, onSelect }: MachineViewProps) {
  const hl = (id: PartId) => highlight.includes(id);
  const sel = (id: PartId) => selected === id;
  const partStroke = (id: PartId) => (sel(id) ? COLORS.flow : hl(id) ? COLORS.flow : COLORS.stroke);
  const flowing = engineOn && pressure > 400;
  const flowClass = flowing ? "hs-flow" : undefined;

  const tankH = 110;
  const fill = Math.max(0, Math.min(100, level)) / 100;

  const hoseColor =
    hose === "leaking" || hose === "failed" ? COLORS.crit : hose === "replaced" ? COLORS.ok : hose === "removed" ? "#6b7280" : undefined;
  const h3Path = "M314 140 C 352 140 356 72 400 72";

  return (
    <svg viewBox="0 0 560 300" className="h-auto w-full" role="group" aria-label="Hydraulic circuit, EXC001">
      <defs>
        <filter id="hs-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <style>{`
        .hs-flow { stroke-dasharray: 6 8; animation: hs-dash 0.9s linear infinite; }
        @keyframes hs-dash { to { stroke-dashoffset: -14; } }
        .hs-highlight > :first-child { filter: url(#hs-glow); }
        .hs-leak { animation: hs-pulse 0.8s ease-in-out infinite; }
        @keyframes hs-pulse { 50% { opacity: .45; } }
        .hs-drip { animation: hs-fall 1.1s ease-in infinite; }
        @keyframes hs-fall { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(150px); opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .hs-flow, .hs-leak, .hs-drip { animation: none; } }
      `}</style>

      {/* Suction: tank → pump */}
      <path d="M110 250 L152 250" stroke={COLORS.line} strokeWidth={4} fill="none" />
      <path d="M110 250 L152 250" stroke={COLORS.flow} strokeWidth={2} fill="none" className={flowClass} opacity={flowing ? 0.7 : 0} />
      {/* Pressure: pump → valve */}
      <path d="M200 250 L232 250 L232 232 L250 232" stroke={COLORS.line} strokeWidth={4} fill="none" />
      <path d="M200 250 L232 250 L232 232 L250 232" stroke={COLORS.flow} strokeWidth={2} fill="none" className={flowClass} opacity={flowing ? 1 : 0} />
      {/* Return: valve → tank */}
      <path d="M250 124 L67 124 L67 150" stroke={COLORS.line} strokeWidth={3} fill="none" strokeDasharray="2 4" />

      {/* Tank with a live sight glass */}
      <Part id="tank" selected={sel("tank")} highlighted={hl("tank")} onSelect={onSelect}>
        <rect x={24} y={150} width={86} height={tankH + 10} rx={6} fill={COLORS.body} stroke={partStroke("tank")} strokeWidth={2} />
        <rect x={30} y={155 + tankH * (1 - fill)} width={74} height={tankH * fill} rx={3} fill={COLORS.oil} opacity={0.55} />
        <line x1={30} x2={104} y1={155 + tankH * 0.08} y2={155 + tankH * 0.08} stroke="#9aa3ad" strokeDasharray="3 3" />
        <text x={67} y={186} textAnchor="middle" className="fill-zinc-100 text-[11px] font-bold">
          Tank
        </text>
        <text x={67} y={202} textAnchor="middle" className="fill-zinc-300 font-mono text-[11px]">
          {level.toFixed(1)}%
        </text>
      </Part>

      {/* Pump */}
      <Part id="pump" selected={sel("pump")} highlighted={hl("pump")} onSelect={onSelect}>
        <circle cx={176} cy={250} r={24} fill={COLORS.body} stroke={partStroke("pump")} strokeWidth={2} />
        <path d="M166 262 L176 236 L186 262 Z" fill={flowing ? COLORS.flow : COLORS.stroke} opacity={0.8} />
        <text x={176} y={292} textAnchor="middle" className="fill-zinc-300 text-[10px] font-semibold">
          Pump · {Math.round(pressure).toLocaleString()} psi
        </text>
      </Part>

      {/* Main control valve */}
      <Part id="valve" selected={sel("valve")} highlighted={hl("valve")} onSelect={onSelect}>
        <rect x={250} y={104} width={64} height={146} rx={4} fill={COLORS.body} stroke={partStroke("valve")} strokeWidth={2} />
        {[132, 168, 208].map((y) => (
          <rect key={y} x={260} y={y} width={44} height={14} rx={2} fill="#242c39" stroke="#4b5563" />
        ))}
        <text x={282} y={122} textAnchor="middle" className="fill-zinc-200 text-[10px] font-bold">
          MCV
        </text>
      </Part>

      {/* Stick and bucket circuits: context, not the fault */}
      <path d="M314 175 C 356 175 360 152 400 152" stroke={COLORS.line} strokeWidth={3} fill="none" />
      <path d="M314 215 C 356 215 360 222 400 222" stroke={COLORS.line} strokeWidth={3} fill="none" />

      {/* Hose H-4, boom rod end */}
      <Part id="hose_h4" selected={sel("hose_h4")} highlighted={hl("hose_h4")} onSelect={onSelect}>
        <path d="M314 118 C 350 118 350 40 430 40 L 520 40 L 520 60" stroke={partStroke("hose_h4") === COLORS.stroke ? COLORS.line : COLORS.flow} strokeWidth={4} fill="none" />
        <text x={470} y={34} textAnchor="middle" className="fill-zinc-400 text-[9px]">
          H-4
        </text>
      </Part>

      {/* Hose H-3, boom head end: the one that fails */}
      <Part id="hose_h3" selected={sel("hose_h3")} highlighted={hl("hose_h3")} onSelect={onSelect}>
        <path
          d={h3Path}
          stroke={hoseColor ?? (hl("hose_h3") || sel("hose_h3") ? COLORS.flow : COLORS.line)}
          strokeWidth={sel("hose_h3") ? 7 : 5}
          strokeDasharray={hose === "removed" ? "4 6" : undefined}
          fill="none"
          className={hose === "leaking" ? "hs-leak" : undefined}
          filter={hose === "leaking" ? "url(#hs-glow)" : undefined}
        />
        {/* A wider invisible stroke so the hose is easy to hit. */}
        <path d={h3Path} stroke="transparent" strokeWidth={18} fill="none" />
        <text x={372} y={128} textAnchor="middle" className={cn("text-[10px] font-bold", hoseColor ? "" : "fill-zinc-400")} fill={hoseColor}>
          H-3
        </text>
      </Part>
      {flowing && hose === "ok" ? (
        <path d={h3Path} stroke={COLORS.flow} strokeWidth={2} fill="none" className="hs-flow pointer-events-none" />
      ) : null}

      {/* Leak point and drips */}
      {hose === "leaking" || hose === "failed" ? (
        <g className="pointer-events-none">
          <circle cx={356} cy={104} r={hose === "leaking" ? 7 : 5} fill={COLORS.crit} className={hose === "leaking" ? "hs-leak" : undefined} />
          {(hose === "leaking" ? [0, 0.35, 0.7] : []).map((d) => (
            <circle key={d} cx={356} cy={110} r={2.5} fill={COLORS.oil} className="hs-drip" style={{ animationDelay: `${d}s` }} />
          ))}
        </g>
      ) : null}
      {spill ? <ellipse cx={356} cy={284} rx={34} ry={6} fill={COLORS.oil} opacity={0.5} className="pointer-events-none" /> : null}

      {/* Cylinders */}
      <Part id="boom_cyl" selected={sel("boom_cyl")} highlighted={hl("boom_cyl")} onSelect={onSelect}>
        <Cylinder y={60} label="Boom" stroke={partStroke("boom_cyl")} />
      </Part>
      <Part id="stick_cyl" selected={sel("stick_cyl")} highlighted={hl("stick_cyl")} onSelect={onSelect}>
        <Cylinder y={140} label="Stick" stroke={partStroke("stick_cyl")} />
      </Part>
      <Part id="bucket_cyl" selected={sel("bucket_cyl")} highlighted={hl("bucket_cyl")} onSelect={onSelect}>
        <Cylinder y={210} label="Bucket" stroke={partStroke("bucket_cyl")} />
      </Part>
    </svg>
  );
}
