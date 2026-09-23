"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import type { HealthStatus } from "@/lib/types";
import { cn, statusStyles } from "@/lib/utils";
import { Sparkline } from "@/components/charts/charts";

export function MetricCard({
  label,
  value,
  unit,
  delta,
  status = "healthy",
  icon,
  href,
  spark,
  sparkColor,
}: {
  label: string;
  value: string | number;
  unit?: string;
  delta?: string;
  status?: HealthStatus;
  icon?: React.ReactNode;
  href?: string;
  spark?: number[];
  sparkColor?: string;
}) {
  const s = statusStyles[status];
  const body = (
    <motion.div
      whileHover={href ? { y: -2 } : undefined}
      className={cn(
        "panel-raised relative flex h-full flex-col justify-between overflow-hidden p-4",
        href && "transition-colors hover:border-white/20",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="label-xs">{label}</span>
        <span className={cn("rounded p-1.5", s.bg, s.text)}>{icon}</span>
      </div>
      <div className="mt-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-4xl font-bold leading-none text-zinc-50">{value}</span>
          {unit ? <span className="text-sm text-muted">{unit}</span> : null}
        </div>
        {delta ? (
          <p className={cn("mt-1.5 text-xs font-semibold", s.text)}>
            {delta}
          </p>
        ) : null}
      </div>
      {spark ? (
        <div className="-mx-1 mt-3">
          <Sparkline data={spark} color={sparkColor} />
        </div>
      ) : null}
      {href ? <ArrowUpRight className="absolute right-3 top-12 size-4 text-muted opacity-0 transition-opacity group-hover:opacity-100" /> : null}
    </motion.div>
  );

  return href ? (
    <Link href={href} className="group block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

export function StatBreakdown({
  items,
}: {
  items: { label: string; value: number; status: HealthStatus }[];
}) {
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div className="panel-raised p-4">
      <p className="label-xs">Fleet health</p>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full">
        {items.map((i) => (
          <div
            key={i.label}
            className={statusStyles[i.status].dot}
            style={{ width: `${(i.value / total) * 100}%` }}
            title={`${i.label}: ${i.value}`}
          />
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-3">
        {items.map((i) => (
          <div key={i.label}>
            <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <span className={cn("size-2 rounded-full", statusStyles[i.status].dot)} />
              {i.label}
            </dt>
            <dd className={cn("font-mono text-2xl font-bold", statusStyles[i.status].text)}>{i.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
