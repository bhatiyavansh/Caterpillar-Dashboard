"use client";

/**
 * Data-display primitives shared by every screen: KPI tiles, gauges, readout
 * rows, tables and section headers.
 *
 * These deliberately do not all look the same. A KPI strip is a flat rail, an
 * inspector row is a label/value pair, a gauge is an arc. Making them identical
 * is what turns an industrial console into a wall of cards.
 */
import * as React from "react";
import type { MachineStatus } from "@/lib/api/contracts";
import { MACHINE_STATUS } from "@/lib/status";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------- KPI rail */

export interface KpiItem {
  label: string;
  value: React.ReactNode;
  unit?: string;
  /** Short qualifier under the value, e.g. "of 10 on site". */
  hint?: string;
  status?: MachineStatus;
  emphasis?: boolean;
}

/**
 * The horizontal KPI rail at the top of the command centre and owner portal.
 * Rendered as a definition list so a screen reader reads label/value pairs.
 */
export function KpiRail({ items, className }: { items: KpiItem[]; className?: string }) {
  return (
    <dl
      className={cn(
        "grid grid-cols-2 divide-white/8 border-y border-white/10 bg-ink-900 sm:grid-cols-3 lg:grid-cols-6 lg:divide-x",
        className,
      )}
    >
      {items.map((item) => {
        const token = item.status ? MACHINE_STATUS[item.status] : null;
        return (
          <div
            key={item.label}
            className={cn(
              "relative min-w-0 border-b border-white/8 px-4 py-3 lg:border-b-0",
              item.emphasis && "bg-white/[0.02]",
            )}
          >
            {token && item.status !== "operating" ? (
              <span className={cn("absolute inset-y-0 left-0 w-0.5", token.dot)} aria-hidden />
            ) : null}
            <dt className="label-xs truncate">{item.label}</dt>
            <dd className="mt-1 flex items-baseline gap-1.5">
              <span
                className={cn(
                  "font-mono text-2xl font-bold leading-none tabular-nums",
                  token && item.status !== "operating" ? token.text : "text-zinc-50",
                )}
              >
                {item.value}
              </span>
              {item.unit ? <span className="text-xs font-medium text-muted">{item.unit}</span> : null}
            </dd>
            {item.hint ? <p className="mt-1 truncate text-[11px] text-muted">{item.hint}</p> : null}
          </div>
        );
      })}
    </dl>
  );
}

/* ----------------------------------------------------------------- Gauge */

/**
 * Arc gauge for a single live reading. The arc is the glanceable part; the
 * numeric value underneath is the precise part.
 */
export function ArcGauge({
  label,
  value,
  min,
  max,
  unit,
  status = "operating",
  decimals = 0,
  /** Marks the limit on the arc so the operator sees how much headroom is left. */
  limit,
  size = 108,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  status?: MachineStatus;
  decimals?: number;
  limit?: number;
  size?: number;
}) {
  const token = MACHINE_STATUS[status];
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const radius = size / 2 - 10;
  const circumference = Math.PI * radius; // half circle
  const cx = size / 2;
  const cy = size / 2 + radius / 2;

  const arc = (from: number, to: number) => {
    const p = (t: number) => {
      const angle = Math.PI - t * Math.PI;
      return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)];
    };
    const [x1, y1] = p(from);
    const [x2, y2] = p(to);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x2} ${y2}`;
  };

  return (
    <figure className="flex flex-col items-center">
      <svg
        width={size}
        height={size * 0.72}
        viewBox={`0 0 ${size} ${size * 0.72}`}
        role="img"
        aria-label={`${label}: ${value.toFixed(decimals)}${unit ?? ""}, ${token.label}`}
      >
        <path d={arc(0, 1)} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={8} strokeLinecap="round" />
        {pct > 0.005 ? (
          <path
            d={arc(0, pct)}
            fill="none"
            stroke={token.hex}
            strokeWidth={8}
            strokeLinecap="round"
            style={{ transition: "d 400ms ease" }}
          />
        ) : null}
        {limit !== undefined ? (
          <line
            {...(() => {
              const t = Math.max(0, Math.min(1, (limit - min) / (max - min || 1)));
              const angle = Math.PI - t * Math.PI;
              return {
                x1: cx + (radius - 8) * Math.cos(angle),
                y1: cy - (radius - 8) * Math.sin(angle),
                x2: cx + (radius + 8) * Math.cos(angle),
                y2: cy - (radius + 8) * Math.sin(angle),
              };
            })()}
            stroke="rgba(255,255,255,0.5)"
            strokeWidth={2}
          />
        ) : null}
        <text
          x={cx}
          y={cy - 6}
          textAnchor="middle"
          className="fill-zinc-50 font-mono font-bold tabular-nums"
          style={{ fontSize: size * 0.2 }}
        >
          {value.toFixed(decimals)}
        </text>
        {unit ? (
          <text x={cx} y={cy + 10} textAnchor="middle" className="fill-zinc-500" style={{ fontSize: size * 0.1 }}>
            {unit}
          </text>
        ) : null}
        <title>{`${label}: ${value.toFixed(decimals)}${unit ?? ""}`}</title>
        <desc>{`Range ${min} to ${max}. Circumference ${circumference.toFixed(0)}.`}</desc>
      </svg>
      <figcaption className="label-xs mt-0.5 text-center">{label}</figcaption>
    </figure>
  );
}

/* --------------------------------------------------------------- Readout */

/** Label/value row used throughout the inspector and cab panels. */
export function Readout({
  label,
  value,
  unit,
  status,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  status?: MachineStatus;
  hint?: string;
  className?: string;
}) {
  const token = status ? MACHINE_STATUS[status] : null;
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5", className)}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="flex items-baseline gap-1 text-right">
        <span
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            token && status !== "operating" ? token.text : "text-zinc-100",
          )}
        >
          {value}
        </span>
        {unit ? <span className="text-[11px] text-muted">{unit}</span> : null}
        {hint ? <span className="ml-1 text-[11px] text-muted">{hint}</span> : null}
      </dd>
    </div>
  );
}

/** A labelled bar — reads faster than a number for percentages. */
export function MeterRow({
  label,
  value,
  status = "operating",
  valueLabel,
  className,
}: {
  label: string;
  value: number;
  status?: MachineStatus;
  valueLabel?: string;
  className?: string;
}) {
  const token = MACHINE_STATUS[status];
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        <span className={cn("font-mono text-xs font-semibold tabular-nums", token.text)}>
          {valueLabel ?? `${Math.round(pct)}%`}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", token.dot)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* --------------------------------------------------------- Section frame */

export function SectionHeader({
  title,
  meta,
  actions,
  className,
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="label-xs !text-zinc-300">{title}</h2>
        {meta ? <span className="truncate text-[11px] text-muted">{meta}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Table */

export function DataTable<T>({
  columns,
  rows,
  getKey,
  onRowClick,
  selectedKey,
  caption,
  empty,
}: {
  columns: { key: string; header: string; align?: "left" | "right"; width?: string; render: (row: T) => React.ReactNode }[];
  rows: T[];
  getKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  caption: string;
  empty?: React.ReactNode;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-white/10">
          {columns.map((c) => (
            <th
              key={c.key}
              scope="col"
              style={{ width: c.width }}
              className={cn(
                "label-xs px-3 py-2 font-semibold",
                c.align === "right" ? "text-right" : "text-left",
              )}
            >
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = getKey(row);
          const selected = selectedKey === key;
          return (
            <tr
              key={key}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              aria-selected={onRowClick ? selected : undefined}
              className={cn(
                "border-b border-white/5 last:border-0",
                onRowClick && "cursor-pointer transition-colors hover:bg-white/[0.04]",
                selected && "bg-cat-500/10",
              )}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn("px-3 py-2.5 align-middle", c.align === "right" && "text-right")}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
