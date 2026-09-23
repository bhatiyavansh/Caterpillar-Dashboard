"use client";

import Link from "next/link";
import { Activity, BellRing, Gauge, TriangleAlert, Truck, Wrench } from "lucide-react";
import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { MetricCard, StatBreakdown } from "@/components/dashboard/metric-card";
import { MachineCard } from "@/components/dashboard/machine-card";
import { CHART_COLORS, MultiBarChart, TrendAreaChart } from "@/components/charts/charts";
import { SeverityIndicator } from "@/components/shared/status";
import { Button } from "@/components/ui/primitives";
import {
  alertTrendSeries,
  fleetSummary,
  machines,
  maintenanceTimeline,
  operatingHoursSeries,
} from "@/lib/mock-data";
import { deriveAdvice } from "@/lib/advice";
import { useMachineHealth, useMachineStore } from "@/store/machine-store";
import { cn, severityStyles } from "@/lib/utils";

export default function OverviewPage() {
  const sensors = useMachineStore((s) => s.sensors);
  const alerts = useMachineStore((s) => s.alerts);
  const liveHealth = useMachineHealth();
  const liveAdvice = deriveAdvice(sensors).filter((a) => a.severity !== "info");

  // The primary machine's live state feeds the fleet counters, so a warning
  // triggered in the cab is visible here immediately.
  const warningCount = fleetSummary.warning + (liveHealth === "warning" ? 1 : 0);
  const criticalCount = fleetSummary.critical + (liveHealth === "critical" ? 1 : 0);
  const healthyCount = fleetSummary.healthy - (liveHealth === "healthy" ? 0 : 1);

  const tempSpark = [78, 80, 79, 82, 84, 83, 86, sensors.engineTemperature];
  const openAlerts = alerts.filter((a) => !a.acknowledged);

  return (
    <div className="pb-10">
      <PageHeader
        title="Fleet Overview"
        subtitle="Monitor machine health, operations and maintenance."
        actions={<RunSimulationButton />}
      />

      <div className="space-y-4 p-4">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Active machines"
            value={fleetSummary.activeMachines}
            delta={`+${fleetSummary.activeDelta} today`}
            icon={<Truck className="size-4" />}
            href="/dashboard/fleet"
            spark={[20, 21, 21, 22, 23, 22, 24, 24]}
          />
          <MetricCard
            label="Machines with warnings"
            value={warningCount}
            status="warning"
            delta={liveHealth === "warning" ? "CAT 320 reporting live warning" : "2 awaiting acknowledgement"}
            icon={<TriangleAlert className="size-4" />}
            href="/dashboard/alerts"
            spark={[3, 4, 3, 5, 4, 4, warningCount, warningCount]}
            sparkColor={CHART_COLORS.warn}
          />
          <MetricCard
            label="Maintenance due"
            value={fleetSummary.maintenanceDue}
            delta="1 overdue · CAT D6"
            status="warning"
            icon={<Wrench className="size-4" />}
            href="/dashboard/maintenance"
            spark={[4, 5, 5, 6, 6, 7, 6, 6]}
            sparkColor={CHART_COLORS.warn}
          />
          <MetricCard
            label="Critical alerts"
            value={criticalCount}
            status="critical"
            delta="Immediate attention required"
            icon={<BellRing className="size-4" />}
            href="/dashboard/alerts"
            spark={[1, 0, 2, 1, 0, 1, criticalCount, criticalCount]}
            sparkColor={CHART_COLORS.crit}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1fr_1.4fr]">
          <StatBreakdown
            items={[
              { label: "Healthy", value: Math.max(0, healthyCount), status: "healthy" },
              { label: "Warning", value: warningCount, status: "warning" },
              { label: "Critical", value: criticalCount, status: "critical" },
            ]}
          />

          <div className="panel-raised p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-100">Operating vs idle hours</p>
                <p className="text-xs text-muted">Fleet average, last 7 days</p>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/reports">Reports</Link>
              </Button>
            </div>
            <div className="mt-3">
              <MultiBarChart
                data={operatingHoursSeries}
                xKey="day"
                stacked
                bars={[
                  { key: "hours", name: "Operating", color: CHART_COLORS.cat },
                  { key: "idle", name: "Idle", color: CHART_COLORS.muted },
                ]}
                height={190}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div className="panel-raised p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-100">CAT 320 · live engine temperature</p>
                <p className="text-xs text-muted">Streaming from the connected machine display</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded border border-white/10 px-2 py-1 text-[11px] text-muted">
                <Activity className="size-3.5 text-status-ok" aria-hidden /> Live
              </span>
            </div>
            <div className="mt-3">
              <TrendAreaChart
                data={tempSpark.map((v, i) => ({ t: `T-${7 - i}`, temp: v }))}
                dataKey="temp"
                color={CHART_COLORS.warn}
                unit="°"
                height={190}
              />
            </div>
          </div>

          <div className="panel-raised p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-zinc-100">Alerts this week</p>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/alerts">All alerts</Link>
              </Button>
            </div>
            <div className="mt-3">
              <MultiBarChart
                data={alertTrendSeries}
                xKey="day"
                stacked
                height={190}
                bars={[
                  { key: "critical", name: "Critical", color: CHART_COLORS.crit },
                  { key: "warning", name: "Warning", color: CHART_COLORS.warn },
                  { key: "info", name: "Info", color: CHART_COLORS.info },
                ]}
              />
            </div>
          </div>
        </section>

        {liveAdvice.length > 0 ? (
          <section className="panel-raised border-l-4 border-l-status-warn p-4">
            <p className="text-sm font-semibold text-zinc-100">Live machine advisories · CAT 320</p>
            <ul className="mt-3 space-y-2">
              {liveAdvice.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 rounded bg-white/4 px-3 py-2.5">
                  <SeverityIndicator severity={a.severity} size="sm" />
                  <span className="text-sm text-zinc-200">{a.title}</span>
                  <span className="text-xs text-muted">{a.body}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted">Machines requiring attention</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/fleet">View fleet</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {machines
              .filter((m) => m.health !== "healthy")
              .concat(machines.filter((m) => m.health === "healthy").slice(0, 1))
              .slice(0, 4)
              .map((m) => (
                <MachineCard key={m.id} machine={m} />
              ))}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Open alerts</p>
            <ul className="mt-3 space-y-2">
              {openAlerts.slice(0, 5).map((a) => (
                <li key={a.id} className={cn("rounded border px-3 py-2.5", severityStyles[a.severity].border)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityIndicator severity={a.severity} size="sm" />
                    <span className="text-sm font-medium text-zinc-100">{a.title}</span>
                    <span className="ml-auto text-[11px] text-muted">{a.timestamp}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {a.machineName} · {a.system}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Maintenance schedule</p>
            <ol className="mt-3 space-y-3">
              {maintenanceTimeline.slice(0, 5).map((t) => (
                <li key={t.date + t.title} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "mt-1.5 size-2.5 shrink-0 rounded-full",
                      t.state === "overdue" ? "bg-status-crit" : t.state === "completed" ? "bg-status-ok" : "bg-cat-500",
                    )}
                  />
                  <div>
                    <p className="text-sm text-zinc-100">{t.title}</p>
                    <p className="text-xs text-muted">
                      {t.machine} · {t.date} · {t.state}
                    </p>
                  </div>
                  <Gauge className="ml-auto size-4 text-muted" aria-hidden />
                </li>
              ))}
            </ol>
          </div>
        </section>
      </div>
    </div>
  );
}
