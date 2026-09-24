"use client";

/**
 * One machine in AR maintenance.
 *
 * When the machine has a breakdown, the whole workspace is here: machine view,
 * diagnosis, telemetry, the suggested fix and both reports. Underneath, or on
 * its own when nothing is wrong, sits the machine's service state: component
 * health, open alerts and a way into the routine procedures.
 */
import Link from "next/link";
import { BookOpen, Siren } from "lucide-react";
import { useAlerts, useMachine, useMaintenance } from "@/lib/hooks/use-site";
import { useFaultStore, useFaultView } from "@/lib/maintenance/fault-store";
import { useAssistantScope } from "@/components/assistant/assistant-provider";
import { MACHINE, phaseAtLeast } from "@/lib/maintenance/hydraulic-leak";
import { Breadcrumbs, PageShell } from "@/components/ui/page";
import { Button } from "@/components/ui/primitives";
import { MachineStatusChip, SeverityChip } from "@/components/ui/status";
import { EmptyPanel } from "@/components/ui/states";
import { relativeTime } from "@/components/alerts/alert-card";
import { FaultWorkspace } from "./fault-workspace";
import { MAINTENANCE_HREF } from "./fault-watcher";
import { cn } from "@/lib/utils";

export function MachineMaintenance({ machineId }: { machineId: string }) {
  const { data: machine } = useMachine(machineId);
  const { data: allItems } = useMaintenance();
  const { data: alerts } = useAlerts({ machineId, includeAcknowledged: false });
  const fault = useFaultView();
  const trigger = useFaultStore((s) => s.trigger);

  const items = allItems.filter((i) => i.machineId === machineId).sort((a, b) => a.healthPct - b.healthPct);
  const breakdown = fault && fault.record.machineId === machineId ? fault : null;
  // The site feed does not know about a simulated breakdown, so it would
  // still call the machine "operating".
  const down = breakdown !== null && phaseAtLeast(breakdown.phase, "detected") && breakdown.phase !== "closed";
  const canSimulate = machineId === MACHINE.id && (!fault || fault.phase === "closed");

  // Point the site assistant at this machine; during a breakdown it opens on
  // the questions a technician asks at the machine.
  useAssistantScope({
    surface: "ar",
    machineId,
    alert: down,
    label: `AR maintenance · ${machineId}`,
    suggestions: down
      ? [
          `Why is ${machineId} losing hydraulic pressure?`,
          "How do I safely check for a hydraulic leak?",
          "What do I do after replacing a hydraulic hose?",
        ]
      : [`When is ${machineId} due for service?`, "What should I check on a daily walk-around?", "What do hydraulic warnings mean?"],
  });

  return (
    <PageShell>
      <header className="space-y-2">
        <Breadcrumbs items={[{ label: "AR maintenance", href: MAINTENANCE_HREF }, { label: machineId }]} />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="font-mono text-xl font-bold tracking-tight text-zinc-50">{machineId}</h1>
              <p className="text-xs text-muted">
                {machine ? `${machine.model} · ${machine.kindLabel} · ${machine.zone}` : "Waiting for this machine to report"}
                {machine?.operator ? ` · ${machine.operator.name}` : ""}
              </p>
            </div>
            {down ? (
              <span className="rounded-full bg-status-crit px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-white">
                Breakdown
              </span>
            ) : machine ? (
              <MachineStatusChip status={machine.status} />
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${MAINTENANCE_HREF}/procedures`}>
                <BookOpen className="size-3.5" aria-hidden />
                Routine procedures
              </Link>
            </Button>
            {canSimulate ? (
              <Button variant="secondary" size="sm" onClick={trigger} title="Demo: start a hydraulic hose leak on this machine">
                <Siren className="size-3.5" aria-hidden />
                Simulate hydraulic leak
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {breakdown ? <FaultWorkspace view={breakdown} /> : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <div className="border-b border-white/10 px-4 py-2.5">
            <h2 className="label-xs !text-zinc-300">Component health</h2>
          </div>
          {items.length ? (
            <ul className="divide-y divide-white/5">
              {items.map((i) => {
                const h = Math.round(i.healthPct);
                return (
                  <li key={i.id} className="px-4 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">{i.title}</span>
                      <span className="shrink-0 font-mono text-xs text-zinc-300">{h}%</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className={cn("h-full rounded-full", h < 30 ? "bg-status-crit" : h < 60 ? "bg-status-warn" : "bg-status-ok")}
                        style={{ width: `${h}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {i.component} · service {i.dueLabel}
                      {i.workOrder ? ` · ${i.workOrder}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyPanel title="No component forecasts" body="The health model has no service forecast for this machine yet." className="!py-8" />
          )}
        </section>

        <section className="panel overflow-hidden">
          <div className="border-b border-white/10 px-4 py-2.5">
            <h2 className="label-xs !text-zinc-300">Open alerts</h2>
          </div>
          {alerts.length ? (
            <ul className="divide-y divide-white/5">
              {alerts.map((a) => (
                <li key={a.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <SeverityChip severity={a.severity} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-100">{a.title}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted">{relativeTime(a.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted">{a.message}</p>
                  <p className="mt-0.5 text-[11px] text-zinc-400">{a.action}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyPanel tone="good" title="No open alerts" body="Nothing is alerting on this machine right now." className="!py-8" />
          )}
        </section>
      </div>
    </PageShell>
  );
}
