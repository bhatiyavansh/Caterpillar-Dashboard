"use client";

import * as React from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { Button } from "@/components/ui/primitives";
import { CHART_COLORS, HealthDonut, MultiBarChart, MultiLineChart, TrendAreaChart } from "@/components/charts/charts";
import {
  alertTrendSeries,
  engineTempSeries,
  fuelSeries,
  maintenanceFrequencySeries,
  operatingHoursSeries,
  utilisationSeries,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const RANGES = ["Today", "7 Days", "30 Days", "90 Days"] as const;
type Range = (typeof RANGES)[number];

const scale: Record<Range, number> = { Today: 0.16, "7 Days": 1, "30 Days": 4.2, "90 Days": 12.5 };

export default function ReportsPage() {
  const [range, setRange] = React.useState<Range>("7 Days");
  const k = scale[range];

  const hours = operatingHoursSeries.map((d) => ({
    ...d,
    hours: Number((d.hours * k).toFixed(1)),
    idle: Number((d.idle * k).toFixed(1)),
  }));

  const totals = {
    operating: hours.reduce((a, b) => a + b.hours, 0),
    idle: hours.reduce((a, b) => a + b.idle, 0),
    fuel: Math.round(fuelSeries.reduce((a, b) => a + b.litres, 0) * k),
    alerts: Math.round(alertTrendSeries.reduce((a, b) => a + b.critical + b.warning + b.info, 0) * k),
  };
  const idlePct = Math.round((totals.idle / (totals.operating + totals.idle)) * 100);

  return (
    <div className="pb-10">
      <PageHeader
        title="Reports"
        subtitle="Utilisation, consumption and reliability across the connected fleet."
        actions={
          <>
            <Button variant="outline" onClick={() => toast.success(`${range} report exported as CSV`)}>
              <Download className="size-4" aria-hidden /> Export
            </Button>
            <RunSimulationButton size="md" />
          </>
        }
      />

      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Report date range">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={cn(
                "h-10 rounded border px-4 text-sm font-semibold transition-colors",
                range === r
                  ? "border-cat-500 bg-cat-500 text-ink-950"
                  : "border-white/12 bg-ink-900 text-zinc-300 hover:bg-white/6",
              )}
            >
              {r}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted">Figures are simulated for demonstration.</span>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Operating hours", value: totals.operating.toFixed(0), unit: "h" },
            { label: "Idle time", value: `${idlePct}`, unit: "%" },
            { label: "Fuel consumed", value: totals.fuel.toLocaleString(), unit: "L" },
            { label: "Alerts raised", value: totals.alerts.toString(), unit: "" },
          ].map((s) => (
            <div key={s.label} className="panel-raised p-4">
              <p className="label-xs">{s.label}</p>
              <p className="mt-2 font-mono text-4xl font-bold text-zinc-50">
                {s.value}
                <span className="ml-1 text-sm text-muted">{s.unit}</span>
              </p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Machine utilisation</p>
            <p className="text-xs text-muted">Share of scheduled time spent working</p>
            <div className="mt-3">
              <MultiBarChart
                data={utilisationSeries}
                xKey="machine"
                stacked
                height={240}
                bars={[
                  { key: "utilisation", name: "Working", color: CHART_COLORS.cat },
                  { key: "idle", name: "Idle", color: CHART_COLORS.muted },
                ]}
              />
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Operating vs idle hours</p>
            <p className="text-xs text-muted">Per day across the selected range</p>
            <div className="mt-3">
              <MultiLineChart
                data={hours}
                xKey="day"
                height={240}
                lines={[
                  { key: "hours", name: "Operating", color: CHART_COLORS.ok },
                  { key: "idle", name: "Idle", color: CHART_COLORS.warn },
                ]}
              />
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Fuel consumption</p>
            <p className="text-xs text-muted">Litres per hour of the shift</p>
            <div className="mt-3">
              <TrendAreaChart data={fuelSeries} dataKey="litres" color={CHART_COLORS.cat} unit=" L" height={240} />
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Maintenance frequency</p>
            <p className="text-xs text-muted">Work orders raised per month</p>
            <div className="mt-3">
              <MultiBarChart
                data={maintenanceFrequencySeries}
                xKey="month"
                height={240}
                bars={[
                  { key: "scheduled", name: "Scheduled", color: CHART_COLORS.info },
                  { key: "unscheduled", name: "Unscheduled", color: CHART_COLORS.crit },
                ]}
              />
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Alerts by severity</p>
            <div className="mt-3">
              <HealthDonut
                height={240}
                data={[
                  { name: "Critical", value: alertTrendSeries.reduce((a, b) => a + b.critical, 0), color: CHART_COLORS.crit },
                  { name: "Warning", value: alertTrendSeries.reduce((a, b) => a + b.warning, 0), color: CHART_COLORS.warn },
                  { name: "Info", value: alertTrendSeries.reduce((a, b) => a + b.info, 0), color: CHART_COLORS.info },
                ]}
              />
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Engine temperature profile</p>
            <p className="text-xs text-muted">CAT 320 · rolling 24 hours</p>
            <div className="mt-3">
              <TrendAreaChart data={engineTempSeries} dataKey="value" color={CHART_COLORS.warn} unit="°" height={240} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
