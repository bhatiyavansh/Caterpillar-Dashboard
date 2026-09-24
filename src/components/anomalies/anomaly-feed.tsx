"use client";

/**
 * Unusual machine usage, as the detector reports it.
 *
 * Two things matter on this screen and both are easy to get wrong. The first is
 * that a detection is a claim, so the evidence that produced it is shown next
 * to it rather than hidden behind a click — an operator accused of idling will
 * ask "says who", and the answer should already be on screen.
 *
 * The second is that co-occurring patterns are the strong signal. Idling alone
 * is a lunch break; idling with the belt unfastened and no load cycles is
 * someone off the seat with the engine running. The related patterns are given
 * the same weight as the primary one for that reason.
 */
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, Fuel, ScanLine, ShieldAlert } from "lucide-react";
import type { Anomaly, AnomalyPattern } from "@/lib/api/contracts";
import { anomalyMetrics } from "@/lib/intel";
import { SeverityChip } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const PATTERN_LABEL: Record<AnomalyPattern, string> = {
  excessive_idling: "Excessive idling",
  seatbelt_violation: "Seatbelt violation",
  overload: "Overload",
  harsh_operation: "Harsh operation",
  temperature_anomaly: "Temperature anomaly",
  low_productivity: "Low productivity",
  unusual_pattern: "Unusual pattern",
};

function inr(value: number): string {
  return `₹${value.toLocaleString("en-IN")}`;
}

function when(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** How the detector rates its own confidence, drawn rather than printed. */
function ScoreMeter({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-700">
        <div
          className={cn(
            "h-full rounded-full",
            score >= 0.9 ? "bg-status-crit" : score >= 0.7 ? "bg-status-warn" : "bg-status-info",
          )}
          style={{ width: `${score * 100}%` }}
        />
      </div>
      <span className="font-mono text-[11px] tabular-nums text-zinc-400">{score.toFixed(2)}</span>
    </div>
  );
}

function AnomalyCard({ anomaly, live }: { anomaly: Anomaly; live: boolean }) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      className={cn(
        "panel-raised space-y-3 p-4",
        live && "border-cat-500/40 shadow-[0_0_28px_-16px_rgba(255,205,0,0.7)]",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-50">{anomaly.title}</h3>
            {live ? (
              <span className="rounded bg-cat-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cat-500">
                This shift
              </span>
            ) : null}
            <SeverityChip severity={anomaly.severity} size="sm" soundKey={anomaly.id} />
          </div>
          <p className="mt-0.5 text-[11px] text-muted">
            {anomaly.machineId} · {when(anomaly.detectedAt)} ·{" "}
            {anomaly.detectedBy === "rules" ? "Safety rules" : "Baseline deviation"}
          </p>
        </div>
        <ScoreMeter score={anomaly.score} />
      </div>

      <p className="text-xs leading-relaxed text-zinc-300">{anomaly.explanation}</p>

      {anomaly.related.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">Co-occurring</span>
          {anomaly.related.map((r) => (
            <span
              key={r}
              className="rounded border border-status-warn/35 bg-status-warn/10 px-1.5 py-0.5 text-[11px] font-medium text-status-warn"
            >
              {PATTERN_LABEL[r]}
            </span>
          ))}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-white/8 pt-2.5 sm:grid-cols-3">
        {Object.entries(anomaly.evidence).map(([key, value]) => (
          <div key={key}>
            <dt className="text-[10px] uppercase tracking-wider text-zinc-500">{key}</dt>
            <dd className="font-mono text-xs font-semibold text-zinc-200">{value}</dd>
          </div>
        ))}
      </dl>

      {anomaly.fuelWastedL > 0 ? (
        <div className="flex items-center gap-2 rounded border border-white/8 bg-ink-900 px-2.5 py-2">
          <Fuel className="size-3.5 shrink-0 text-status-warn" aria-hidden />
          <p className="text-[11px] text-zinc-300">
            <span className="font-mono font-bold text-zinc-100">{anomaly.fuelWastedL} L</span> burnt
            producing nothing —{" "}
            <span className="font-mono font-bold text-zinc-100">{inr(anomaly.costInr)}</span>
          </p>
        </div>
      ) : null}
    </motion.article>
  );
}

export function AnomalyFeed({ anomalies }: { anomalies: Anomaly[] }) {
  const [filter, setFilter] = React.useState<"all" | AnomalyPattern>("all");

  const live = anomalies.filter((a) => a.id.startsWith("ANO-LIVE"));
  const shown = filter === "all" ? anomalies : anomalies.filter((a) => a.pattern === filter);

  const patterns = React.useMemo(() => {
    const counts = new Map<AnomalyPattern, number>();
    for (const a of anomalies) counts.set(a.pattern, (counts.get(a.pattern) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [anomalies]);

  const wasted = anomalies.reduce((sum, a) => sum + a.costInr, 0);

  return (
    <div className="space-y-5">
      <section className="panel-raised p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Detector</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              Named safety patterns first, then whatever sits too far from a machine&apos;s own
              30-day normal. {live.length} open on this shift.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded border border-white/10 bg-ink-850 px-3 py-1.5">
            <ScanLine className="size-4 text-cat-500" aria-hidden />
            <div className="text-[11px] leading-tight">
              <div className="font-semibold text-zinc-200">
                {anomalyMetrics.brief_sample
                  ? `${anomalyMetrics.brief_sample.detected}/${anomalyMetrics.brief_sample.expected_alerts} brief rows flagged`
                  : "Validated against the brief"}
              </div>
              <div className="text-zinc-500">
                {anomalyMetrics.brief_sample?.false_alarms ?? 0} false alarms
              </div>
            </div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded border border-white/8 bg-ink-850 p-3">
            <dt className="label-xs">Open now</dt>
            <dd className="mt-1 flex items-baseline gap-1.5 font-mono text-lg font-bold tabular-nums text-zinc-50">
              <Activity className="size-4 text-cat-500" aria-hidden />
              {live.length}
            </dd>
          </div>
          <div className="rounded border border-white/8 bg-ink-850 p-3">
            <dt className="label-xs">Total detections</dt>
            <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-zinc-50">
              {anomalies.length}
            </dd>
          </div>
          <div className="rounded border border-white/8 bg-ink-850 p-3">
            <dt className="label-xs">By rule</dt>
            <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-zinc-50">
              {anomalies.filter((a) => a.detectedBy === "rules").length}
            </dd>
          </div>
          <div className="rounded border border-white/8 bg-ink-850 p-3">
            <dt className="label-xs">Wasted fuel</dt>
            <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-zinc-50">
              {inr(wasted)}
            </dd>
          </div>
        </dl>
      </section>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setFilter("all")}
          aria-pressed={filter === "all"}
          className={cn(
            "rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors",
            filter === "all"
              ? "border-cat-500 bg-cat-500/12 text-cat-500"
              : "border-white/12 text-muted hover:text-zinc-200",
          )}
        >
          All {anomalies.length}
        </button>
        {patterns.map(([pattern, count]) => (
          <button
            key={pattern}
            type="button"
            onClick={() => setFilter(pattern)}
            aria-pressed={filter === pattern}
            className={cn(
              "rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors",
              filter === pattern
                ? "border-cat-500 bg-cat-500/12 text-cat-500"
                : "border-white/12 text-muted hover:text-zinc-200",
            )}
          >
            {PATTERN_LABEL[pattern]} {count}
          </button>
        ))}
      </div>

      {shown.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <AnimatePresence initial={false}>
            {shown.map((a) => (
              <AnomalyCard key={a.id} anomaly={a} live={a.id.startsWith("ANO-LIVE")} />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <EmptyState
          icon={<ShieldAlert className="size-6 text-status-ok" aria-hidden />}
          title="Nothing unusual"
          body="No machine is outside its normal operating pattern for this filter."
        />
      )}
    </div>
  );
}
