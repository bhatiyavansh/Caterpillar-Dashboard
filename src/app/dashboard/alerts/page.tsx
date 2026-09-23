"use client";

import * as React from "react";
import Link from "next/link";
import { BellOff, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { SeverityIndicator } from "@/components/shared/status";
import { Button, EmptyState } from "@/components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { deriveAdvice } from "@/lib/advice";
import type { Severity } from "@/lib/types";
import { cn, severityStyles } from "@/lib/utils";
import { useMachineStore } from "@/store/machine-store";

export default function AlertsPage() {
  const alerts = useMachineStore((s) => s.alerts);
  const acknowledge = useMachineStore((s) => s.acknowledgeAlert);
  const sensors = useMachineStore((s) => s.sensors);
  const [tab, setTab] = React.useState<"all" | Severity>("all");

  // Live advisories from the simulated machine are surfaced alongside seeded alerts.
  const liveAlerts = deriveAdvice(sensors)
    .filter((a) => a.severity !== "info")
    .map((a) => ({
      id: `live-${a.id}`,
      severity: a.severity,
      machineId: "CAT-320-014",
      machineName: "CAT 320",
      title: a.title,
      description: a.body,
      recommendedAction: a.body,
      timestamp: "Live",
      system: "Telemetry",
      acknowledged: false,
    }));

  const all = [...liveAlerts, ...alerts];
  const filtered = tab === "all" ? all : all.filter((a) => a.severity === tab);

  const counts = {
    critical: all.filter((a) => a.severity === "critical").length,
    warning: all.filter((a) => a.severity === "warning").length,
    info: all.filter((a) => a.severity === "info").length,
  };

  return (
    <div className="pb-10">
      <PageHeader
        title="Alerts"
        subtitle="Every machine condition requiring review, ranked by severity."
        actions={<RunSimulationButton size="md" />}
      />

      <div className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {(["critical", "warning", "info"] as Severity[]).map((s) => (
            <div key={s} className={cn("panel-raised border-l-4 p-4", severityStyles[s].border)}>
              <div className="flex items-center justify-between">
                <SeverityIndicator severity={s} size="sm" />
                <span className={cn("font-mono text-3xl font-bold", severityStyles[s].text)}>{counts[s]}</span>
              </div>
              <p className="mt-2 text-xs text-muted">
                {s === "critical"
                  ? "Stop-work conditions requiring immediate response."
                  : s === "warning"
                    ? "Degrading conditions to resolve this shift."
                    : "Informational events logged for the record."}
              </p>
            </div>
          ))}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">All ({all.length})</TabsTrigger>
            <TabsTrigger value="critical">Critical</TabsTrigger>
            <TabsTrigger value="warning">Warning</TabsTrigger>
            <TabsTrigger value="info">Info</TabsTrigger>
          </TabsList>
        </Tabs>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<BellOff className="size-8" />}
            title="No alerts in this category"
            body="Nothing is currently reported at this severity across the fleet."
          />
        ) : (
          <ul className="space-y-3">
            {filtered.map((a) => (
              <li key={a.id} className={cn("panel-raised border-l-4 p-4", severityStyles[a.severity].border)}>
                <div className="flex flex-wrap items-center gap-3">
                  <SeverityIndicator severity={a.severity} size="sm" />
                  <Link
                    href={`/dashboard/machines/${a.machineId}`}
                    className="text-sm font-semibold text-zinc-100 hover:text-cat-500"
                  >
                    {a.machineName}
                  </Link>
                  <span className="rounded border border-white/10 px-2 py-0.5 text-[11px] uppercase tracking-widest text-muted">
                    {a.system}
                  </span>
                  <span className="ml-auto text-xs text-muted">{a.timestamp}</span>
                </div>

                <p className="mt-2 text-base font-semibold text-zinc-100">{a.title}</p>
                <p className="mt-1 text-sm text-zinc-400">{a.description}</p>

                <div className="mt-3 rounded border border-white/10 bg-ink-850 p-3">
                  <p className="label-xs">Recommended action</p>
                  <p className="mt-1 text-sm text-zinc-300">{a.recommendedAction}</p>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  {a.acknowledged ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-status-ok">
                      <CheckCheck className="size-4" aria-hidden /> Acknowledged
                    </span>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (a.id.startsWith("live-")) {
                          toast.info("Live advisories clear automatically once readings return to range");
                          return;
                        }
                        acknowledge(a.id);
                        toast.success(`Alert ${a.id} acknowledged`);
                      }}
                    >
                      Acknowledge
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/dashboard/machines/${a.machineId}`}>Open machine</Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
