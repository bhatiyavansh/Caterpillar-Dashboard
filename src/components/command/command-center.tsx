"use client";

/**
 * Site command centre — the primary surface.
 *
 * Reading order is deliberate: the KPI rail says how the site is doing, the
 * alert strip says what is wrong right now, the fleet list says which machine,
 * the twin says where, and the inspector says what to do about it.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { Boxes, ListFilter, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from "lucide-react";
import { FleetList } from "./fleet-list";
import { MachineInspector } from "./machine-inspector";
import { TimelineBar } from "./timeline-bar";
import { TwinViewport } from "@/components/twin/twin-viewport";
import { AlertCard } from "@/components/alerts/alert-card";
import { KpiRail, SectionHeader, type KpiItem } from "@/components/ui/data";
import { EmptyPanel, SkeletonRows } from "@/components/ui/states";
import { Button } from "@/components/ui/primitives";
import { useAlerts, useFleet, useTimelineMarkers } from "@/lib/hooks/use-site";
import { PRIMARY_MACHINE_ID } from "@/lib/api/seed";
import { cn } from "@/lib/utils";

function buildKpis(kpis: ReturnType<typeof useFleet>["kpis"]): KpiItem[] {
  if (!kpis) {
    return [
      { label: "Fleet", value: "—" },
      { label: "Active", value: "—" },
      { label: "At risk", value: "—" },
      { label: "Alerts", value: "—" },
      { label: "Utilisation", value: "—" },
      { label: "Fuel", value: "—" },
    ];
  }
  return [
    { label: "Fleet", value: kpis.fleetSize, hint: "machines registered" },
    { label: "Active", value: kpis.active, hint: `of ${kpis.fleetSize} on site` },
    {
      label: "At risk",
      value: kpis.atRisk,
      status: kpis.atRisk > 1 ? "critical" : kpis.atRisk ? "warning" : "operating",
      hint: kpis.atRisk ? "needing a decision" : "all within limits",
      emphasis: kpis.atRisk > 0,
    },
    {
      label: "Alerts",
      value: kpis.openAlerts,
      status: kpis.openAlerts ? "warning" : "operating",
      hint: kpis.openAlerts ? "unacknowledged" : "nothing open",
      emphasis: kpis.openAlerts > 0,
    },
    { label: "Utilisation", value: kpis.utilization, unit: "%", hint: "fleet average, this shift" },
    { label: "Fuel", value: kpis.fuelUsedL.toLocaleString("en-IN"), unit: "L", hint: "burnt this shift" },
  ];
}

export function CommandCenter() {
  const params = useSearchParams();
  const { data: machines, kpis, snapshot, loading } = useFleet();
  const { data: alerts, acknowledge, acknowledgeAll } = useAlerts();
  const { data: markers } = useTimelineMarkers();

  const [selectedId, setSelectedId] = React.useState<string | null>(params.get("machine") ?? PRIMARY_MACHINE_ID);
  const [replayAt, setReplayAt] = React.useState<number | null>(null);
  const [railOpen, setRailOpen] = React.useState(true);

  /**
   * Below `lg` there is not room for three panes side by side, so the console
   * becomes one pane at a time. Above `lg` this state is ignored and all three
   * show at once — the tab bar is hidden there.
   */
  const [pane, setPane] = React.useState<"fleet" | "site" | "inspector">("site");

  // A new critical alert pulls the inspector onto the machine that raised it,
  // so the manager is already looking at the right thing when they glance up.
  const lastCritical = React.useRef<string | null>(null);
  React.useEffect(() => {
    const critical = alerts.find((a) => a.severity === "critical" && !a.acknowledged);
    if (critical && critical.id !== lastCritical.current) {
      lastCritical.current = critical.id;
      if (critical.machineId !== "SITE") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to a new alert arriving from the external site stream
        setSelectedId(critical.machineId);
      }
    }
    if (!critical) lastCritical.current = null;
  }, [alerts]);

  const selected = machines.find((m) => m.id === selectedId) ?? null;
  const openAlerts = alerts.filter((a) => !a.acknowledged);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <KpiRail items={buildKpis(kpis)} />

      {/* Pane switcher — small screens only */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 bg-ink-900 px-2 py-1.5 lg:hidden">
        {([
          { id: "fleet" as const, label: "Fleet", icon: ListFilter },
          { id: "site" as const, label: "Site", icon: Boxes },
          { id: "inspector" as const, label: "Inspector", icon: SlidersHorizontal },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPane(id)}
            aria-pressed={pane === id}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
              pane === id ? "bg-cat-500 text-ink-950" : "text-muted hover:bg-white/5 hover:text-zinc-200",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Fleet rail */}
        <FleetList
          machines={machines}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setPane("inspector");
          }}
          loading={loading}
          className={cn(
            "shrink-0 transition-[width] max-lg:w-full lg:w-64",
            pane === "fleet" ? "flex" : "hidden lg:flex",
            !railOpen && "xl:w-0 xl:overflow-hidden xl:border-0",
          )}
        />

        {/* Twin + live alert strip */}
        <div className={cn("min-w-0 flex-1 flex-col", pane === "site" ? "flex" : "hidden lg:flex")}>
          <div className="flex items-center gap-2 border-b border-white/10 bg-ink-900 px-2 py-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-7 xl:inline-flex"
              aria-label={railOpen ? "Hide the fleet list" : "Show the fleet list"}
              onClick={() => setRailOpen((v) => !v)}
            >
              {railOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
            </Button>
            <h2 className="label-xs !text-zinc-300">Site view</h2>
            <span className="truncate text-[11px] text-muted">
              {machines.filter((m) => m.status !== "offline").length} machines reporting
              {snapshot.activeScenario ? ` · scenario: ${snapshot.activeScenario.replace(/_/g, " ")}` : ""}
            </span>
          </div>

          <TwinViewport
            machines={machines}
            alerts={alerts}
            selectedId={selectedId}
            onSelect={setSelectedId}
            markers={markers}
            replayAt={replayAt}
            loading={loading}
            className="min-h-0 flex-1"
          />

          <TimelineBar now={snapshot.t} markers={markers} replayAt={replayAt} onReplayAtChange={setReplayAt} />
        </div>

        {/* Inspector */}
        <div
          className={cn(
            "shrink-0 flex-col max-lg:w-full lg:flex lg:w-80 2xl:w-96",
            pane === "inspector" ? "flex" : "hidden lg:flex",
          )}
        >
          <MachineInspector
            machine={selected}
            alerts={alerts}
            onAcknowledge={acknowledge}
            className="min-h-0 flex-1"
          />
        </div>
      </div>

      {/* Alert deck — full width so nothing critical hides in a rail */}
      <section className="shrink-0 border-t border-white/10 bg-ink-900" aria-label="Active alerts">
        <SectionHeader
          title="Active alerts"
          meta={openAlerts.length ? `${openAlerts.length} awaiting acknowledgement` : "Site nominal"}
          actions={
            openAlerts.length ? (
              <Button variant="outline" size="sm" onClick={acknowledgeAll}>
                Acknowledge all
              </Button>
            ) : null
          }
        />
        <div className="max-h-52 overflow-y-auto p-2.5">
          {loading ? (
            <SkeletonRows rows={2} />
          ) : alerts.length ? (
            <div className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
              <AnimatePresence initial={false}>
                {alerts.map((a) => (
                  <AlertCard key={a.id} alert={a} onAcknowledge={acknowledge} onSelect={(x) => setSelectedId(x.machineId)} />
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <EmptyPanel
              tone="good"
              title="No active alerts"
              body="Every machine on site is inside its safety, stability and health limits. The stream is live and rules are running."
              className="!py-6"
            />
          )}
        </div>
      </section>
    </div>
  );
}
