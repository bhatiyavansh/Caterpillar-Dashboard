"use client";

/**
 * Live top-down site plan.
 *
 * This is the working spatial view until the 3D twin is dropped in, and it
 * stays as the documented fallback if the twin has trouble on the night. It
 * reads the same machine positions, safety bubbles and predicted paths the 3D
 * scene does, so switching between them changes fidelity, not meaning.
 */
import * as React from "react";
import type { Machine, SiteAlert, TimelineMarker } from "@/lib/api/contracts";
import { MACHINE_STATUS } from "@/lib/status";
import { SITE_EXTENT, SITE_ZONES, type TwinSceneProps } from "./twin-contract";
import { cn } from "@/lib/utils";

const ZONE_FILL: Record<string, string> = {
  dig: "rgba(255,205,17,0.05)",
  haul: "rgba(255,255,255,0.04)",
  stock: "rgba(74,168,255,0.05)",
  service: "rgba(61,220,132,0.04)",
};

const KIND_GLYPH: Record<Machine["kind"], string> = {
  excavator: "EX",
  dozer: "DZ",
  loader: "LD",
  truck: "TK",
  grader: "GR",
};

/** Machines whose predicted paths cross within the conflict radius. */
function conflictPairs(machines: Machine[], alerts: SiteAlert[]): [Machine, Machine][] {
  const pairs: [Machine, Machine][] = [];
  const collision = alerts.filter((a) => a.kind === "collision");
  for (const alert of collision) {
    const ids = Object.values(alert.detail)
      .join(" ")
      .match(/[A-Z]{3}\d{3}/g);
    if (!ids || ids.length < 2) continue;
    const a = machines.find((m) => m.id === ids[0]);
    const b = machines.find((m) => m.id === ids[1]);
    if (a && b) pairs.push([a, b]);
  }
  return pairs;
}

export function SitePlan({
  machines,
  alerts,
  selectedId,
  onSelect,
  layers,
  replayAt,
  markers,
}: TwinSceneProps) {
  const { minX, maxX, minZ, maxZ } = SITE_EXTENT;
  const w = maxX - minX;
  const h = maxZ - minZ;

  const conflicts = React.useMemo(() => conflictPairs(machines, alerts), [machines, alerts]);
  const visible = machines.filter((m) => m.status !== "offline");

  return (
    <svg
      viewBox={`${minX} ${minZ} ${w} ${h}`}
      className="size-full"
      role="group"
      aria-label="Live site plan showing machine positions, zones and hazards"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="plan-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="0.4" />
        </pattern>
        <radialGradient id="heat">
          <stop offset="0%" stopColor="rgba(255,77,79,0.42)" />
          <stop offset="100%" stopColor="rgba(255,77,79,0)" />
        </radialGradient>
        <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#ff4d4f" />
        </marker>
      </defs>

      <rect x={minX} y={minZ} width={w} height={h} fill="url(#plan-grid)" />

      {/* Zones */}
      {layers.zones
        ? SITE_ZONES.map((z) => (
            <g key={z.id}>
              <rect
                x={z.x}
                y={z.z}
                width={z.w}
                height={z.d}
                rx={2}
                fill={ZONE_FILL[z.kind]}
                stroke="rgba(255,255,255,0.09)"
                strokeWidth={0.5}
                strokeDasharray={z.kind === "haul" ? "3 2" : undefined}
              />
              <text
                x={z.x + 2.5}
                y={z.z + 6}
                fill="rgba(255,255,255,0.32)"
                fontSize={4.4}
                fontWeight={600}
                letterSpacing={0.6}
                style={{ textTransform: "uppercase" }}
              >
                {z.label}
              </text>
            </g>
          ))
        : null}

      {/* Incident density */}
      {layers.heatmap
        ? markers.map((m) => {
            const machine = machines.find((x) => x.id === m.machineId);
            if (!machine) return null;
            return (
              <circle
                key={`heat-${m.id}`}
                cx={machine.position.x}
                cy={machine.position.z}
                r={m.severity === "critical" ? 26 : 16}
                fill="url(#heat)"
              />
            );
          })
        : null}

      {/* Predicted conflicts */}
      {layers.v2v
        ? conflicts.map(([a, b]) => (
            <g key={`v2v-${a.id}-${b.id}`}>
              <line
                x1={a.position.x}
                y1={a.position.z}
                x2={b.position.x}
                y2={b.position.z}
                stroke="#ff4d4f"
                strokeWidth={0.9}
                strokeDasharray="3 2"
                markerEnd="url(#arrow)"
              >
                <animate attributeName="stroke-opacity" values="0.35;1;0.35" dur="1.4s" repeatCount="indefinite" />
              </line>
              <text
                x={(a.position.x + b.position.x) / 2}
                y={(a.position.z + b.position.z) / 2 - 2}
                fill="#ff4d4f"
                fontSize={4.2}
                fontWeight={700}
                textAnchor="middle"
              >
                CONFLICT
              </text>
            </g>
          ))
        : null}

      {/* Machines */}
      {visible.map((m) => {
        const token = MACHINE_STATUS[m.status];
        const selected = selectedId === m.id;
        const hazard = m.proximity.level !== "safe";
        return (
          <g
            key={m.id}
            transform={`translate(${m.position.x} ${m.position.z})`}
            role="button"
            tabIndex={0}
            aria-label={`${m.id}, ${m.model}, ${token.label}${m.taskLabel ? `, ${m.taskLabel}` : ""}`}
            onClick={() => onSelect(selected ? null : m.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(selected ? null : m.id);
              }
            }}
            className="cursor-pointer outline-none [&:focus-visible>circle:first-child]:stroke-cat-500"
          >
            {/* Safety bubble */}
            {layers.bubbles ? (
              <circle
                r={hazard ? 9 : 7}
                fill={hazard ? "rgba(255,77,79,0.12)" : "rgba(61,220,132,0.07)"}
                stroke={hazard ? "#ff4d4f" : "rgba(61,220,132,0.4)"}
                strokeWidth={hazard ? 0.7 : 0.4}
                strokeDasharray={hazard ? undefined : "2 1.5"}
              >
                {hazard ? (
                  <animate attributeName="r" values="9;10.5;9" dur="1.5s" repeatCount="indefinite" />
                ) : null}
              </circle>
            ) : (
              <circle r={0} />
            )}

            {/* Heading indicator */}
            <path
              d="M 0 -6.4 L 2 -3.4 L -2 -3.4 Z"
              fill={token.hex}
              transform={`rotate(${m.heading})`}
              opacity={0.9}
            />

            {/* Body */}
            <rect
              x={-4}
              y={-3}
              width={8}
              height={6}
              rx={1}
              fill={selected ? token.hex : "#14171c"}
              stroke={token.hex}
              strokeWidth={selected ? 1.1 : 0.7}
            />
            <text
              y={1.5}
              textAnchor="middle"
              fontSize={3.6}
              fontWeight={800}
              fill={selected ? "#0a0b0d" : token.hex}
            >
              {KIND_GLYPH[m.kind]}
            </text>
            <text y={8.5} textAnchor="middle" fontSize={3.4} fontWeight={700} fill="rgba(255,255,255,0.65)">
              {m.id}
            </text>

            {/* Person in the envelope */}
            {layers.workers && m.proximity.nearestPersonM !== null ? (
              <g transform={`translate(0 ${Math.min(9, m.proximity.nearestPersonM)})`}>
                <circle r={1.5} fill="#ff4d4f" stroke="#0a0b0d" strokeWidth={0.4} />
                <text y={4.2} textAnchor="middle" fontSize={3} fontWeight={700} fill="#ff4d4f">
                  {m.proximity.nearestPersonM.toFixed(1)}m
                </text>
              </g>
            ) : null}
          </g>
        );
      })}

      {replayAt !== null ? (
        <text x={minX + 4} y={minZ + 8} fontSize={5} fontWeight={700} fill="#ffcd11" letterSpacing={0.8}>
          REPLAY
        </text>
      ) : null}
    </svg>
  );
}

/** Legend for the plan. Kept beside the canvas so the canvas stays uncluttered. */
export function SitePlanLegend({ className }: { className?: string }) {
  const items = [
    { label: "Operating", hex: MACHINE_STATUS.operating.hex },
    { label: "Idle", hex: MACHINE_STATUS.idle.hex },
    { label: "Warning", hex: MACHINE_STATUS.warning.hex },
    { label: "Critical", hex: MACHINE_STATUS.critical.hex },
  ];
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-[10px] text-muted">
          <span className="size-2 rounded-sm" style={{ background: i.hex }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}
