"use client";

/**
 * Demo control.
 *
 * Run from a second screen during the presentation, so it is built for
 * glancing at, not reading: big targets, grouped the way the demo script runs,
 * each one saying where to be looking when it fires. Every button reports what
 * actually happened, because a presenter needs to know within a second whether
 * to keep talking or hit it again.
 */
import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, Loader2, MonitorCog, RotateCcw, X } from "lucide-react";
import { DIRECTOR_SCENARIOS } from "@/lib/api";
import type { DirectorScenario, DirectorScenarioId } from "@/lib/api/contracts";
import { useAlerts, useDirector, useSnapshot } from "@/lib/hooks/use-site";
import { Button } from "@/components/ui/primitives";
import { SectionHeader } from "@/components/ui/data";
import { PageShell } from "@/components/ui/page";
import { SeverityChip } from "@/components/ui/status";
import { EmptyPanel } from "@/components/ui/states";
import { relativeTime } from "@/components/alerts/alert-card";
import { cn } from "@/lib/utils";

const GROUP_ORDER: DirectorScenario["group"][] = [
  "Safety",
  "Operations",
  "Environment",
  "Machine health",
  "Anomalies",
  "System",
];

type DemoStep =
  | { at: string; label: string; scenario: DirectorScenarioId; href?: undefined }
  | { at: string; label: string; href: string; scenario?: undefined };

/** The run order from the demo script, so the presenter can follow the rail. */
const DEMO_STEPS: DemoStep[] = [
  { at: "0:20", label: "Shift start on the cab", href: "/cab" },
  { at: "0:35", label: "Rain incoming", scenario: "rain" },
  { at: "0:50", label: "Unbuckle seatbelt", scenario: "unbuckle" },
  { at: "1:10", label: "Worker behind machine", scenario: "worker_proximity" },
  { at: "1:45", label: "Dozer reversing", scenario: "dozer_reversing" },
  { at: "2:05", label: "Heavy lift on slope", scenario: "heavy_lift_slope" },
  { at: "2:30", label: "Owner portal impact", href: "/owner" },
  { at: "3:05", label: "Inject idle anomaly", scenario: "idle_anomaly" },
  { at: "3:40", label: "Training replay", href: "/training" },
];

function ScenarioButton({
  scenario,
  pending,
  active,
  onTrigger,
}: {
  scenario: DirectorScenario;
  pending: boolean;
  active: boolean;
  onTrigger: () => void;
}) {
  // A second press on a scenario that is already running usually means the
  // presenter did not see it land, so it stays pressable but says it is on.
  return (
    <button
      onClick={onTrigger}
      disabled={pending}
      aria-pressed={active}
      className={cn(
        "group relative flex min-h-24 w-full flex-col justify-between gap-1.5 rounded border p-3 text-left transition-colors",
        "disabled:cursor-wait disabled:opacity-70",
        scenario.destructive
          ? "border-status-crit/40 bg-status-crit/8 hover:border-status-crit/70 hover:bg-status-crit/12"
          : active
            ? "border-cat-500 bg-cat-500/12"
            : "border-white/12 bg-ink-850 hover:border-cat-500/50 hover:bg-white/[0.04]",
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "text-sm font-bold leading-tight",
            scenario.destructive ? "text-status-crit" : active ? "text-cat-500" : "text-zinc-50",
          )}
        >
          {scenario.label}
        </span>
        {pending ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-cat-500" aria-hidden />
        ) : active ? (
          <span className="shrink-0 rounded bg-cat-500 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-ink-950">
            Running
          </span>
        ) : scenario.destructive ? (
          <RotateCcw className="size-4 shrink-0 text-status-crit" aria-hidden />
        ) : null}
      </span>

      <span className="text-[11px] leading-relaxed text-muted">{scenario.description}</span>

      <span className="flex items-center justify-between gap-2 pt-0.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          Watch {scenario.watchOn}
        </span>
        {scenario.holdSeconds ? (
          <span className="font-mono text-[10px] text-zinc-500">{scenario.holdSeconds}s</span>
        ) : null}
      </span>
    </button>
  );
}

export function DirectorPanel() {
  const { active, pending, log, trigger } = useDirector();
  const snapshot = useSnapshot();
  const { data: alerts } = useAlerts({ includeAcknowledged: false });

  const grouped = React.useMemo(
    () =>
      GROUP_ORDER.map((group) => ({
        group,
        items: DIRECTOR_SCENARIOS.filter((s) => s.group === group),
      })).filter((g) => g.items.length),
    [],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Unmistakably internal */}
      <div className="hazard-stripe h-1.5 shrink-0" aria-hidden />

      <PageShell>
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded bg-cat-500 text-ink-950">
              <MonitorCog className="size-6" aria-hidden />
            </span>
            <div>
              <h1 className="text-lg font-bold leading-tight tracking-tight text-zinc-50">Demo control</h1>
              <p className="text-xs text-muted">
                Internal only. Every button drives the live site that the other screens are reading.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-right">
            <div className="rounded border border-white/10 bg-ink-850 px-3 py-1.5">
              <p className="label-xs">Open alerts</p>
              <p className="font-mono text-lg font-bold tabular-nums text-zinc-50">{alerts.length}</p>
            </div>
            <div className="rounded border border-white/10 bg-ink-850 px-3 py-1.5">
              <p className="label-xs">Site risk</p>
              <p className="font-mono text-lg font-bold tabular-nums text-zinc-50">{snapshot?.riskScore ?? "—"}</p>
            </div>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          {/* Scenarios */}
          <div className="space-y-5">
            {grouped.map(({ group, items }) => (
              <section key={group}>
                <h2 className="label-xs mb-2">{group}</h2>
                <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((s) => (
                    <ScenarioButton
                      key={s.id}
                      scenario={s}
                      pending={pending === s.id}
                      active={active === s.id}
                      onTrigger={() => trigger(s.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Run sheet + log */}
          <div className="space-y-4">
            <section className="overflow-hidden rounded border border-white/10 bg-ink-900">
              <SectionHeader title="Run sheet" meta="4 minutes" />
              <ol className="divide-y divide-white/5">
                {DEMO_STEPS.map((step) => {
                  const scenario = step.scenario ?? null;
                  const isActive = scenario && active === scenario;
                  return (
                    <li key={step.at}>
                      {scenario ? (
                        <button
                          onClick={() => trigger(scenario)}
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/[0.04]",
                            isActive && "bg-cat-500/10",
                          )}
                        >
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-cat-500">{step.at}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{step.label}</span>
                          {isActive ? <Check className="size-3.5 shrink-0 text-cat-500" aria-hidden /> : null}
                        </button>
                      ) : (
                        <Link
                          href={step.href ?? "/command"}
                          className="flex w-full items-center gap-2.5 px-3 py-2 transition-colors hover:bg-white/[0.04]"
                        >
                          <span className="shrink-0 font-mono text-[11px] tabular-nums text-cat-500">{step.at}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{step.label}</span>
                          <ArrowUpRight className="size-3.5 shrink-0 text-muted" aria-hidden />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>

            <section className="overflow-hidden rounded border border-white/10 bg-ink-900">
              <SectionHeader title="Dispatch log" />
              {log.length ? (
                <ul className="max-h-64 divide-y divide-white/5 overflow-y-auto">
                  <AnimatePresence initial={false}>
                    {log.map((r) => (
                      <motion.li
                        key={`${r.scenario}-${r.at}`}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-start gap-2 px-3 py-2"
                      >
                        <span className={cn("mt-0.5 shrink-0", r.ok ? "text-status-ok" : "text-status-crit")}>
                          {r.ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-zinc-100">
                            {r.scenario.replace(/_/g, " ")}
                          </span>
                          <span className="block truncate text-[11px] text-muted">{r.message}</span>
                        </span>
                        <span className="shrink-0 font-mono text-[10px] text-muted">{relativeTime(r.at)}</span>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              ) : (
                <EmptyPanel
                  title="Nothing dispatched yet"
                  body="Trigger a scenario and its result will appear here, with whether the backend or the local simulation handled it."
                  className="!py-6"
                />
              )}
            </section>

            <section className="overflow-hidden rounded border border-white/10 bg-ink-900">
              <SectionHeader title="Live site state" />
              <div className="space-y-1.5 p-3">
                {alerts.length ? (
                  alerts.slice(0, 5).map((a) => (
                    <div key={a.id} className="flex items-center gap-2">
                      <SeverityChip severity={a.severity} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-300">{a.title}</span>
                      <span className="shrink-0 font-mono text-[10px] text-muted">{a.machineId}</span>
                    </div>
                  ))
                ) : (
                  <p className="py-3 text-center text-[11px] text-muted">
                    Site nominal. Nothing is currently alerting.
                  </p>
                )}
              </div>
            </section>

            <Button variant="outline" size="lg" className="w-full" asChild>
              <Link href="/command">Back to the command centre</Link>
            </Button>
          </div>
        </div>
      </PageShell>
    </div>
  );
}
