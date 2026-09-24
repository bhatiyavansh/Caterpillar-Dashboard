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
import { Boxes, ListFilter, MessageCircle, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from "lucide-react";
import { FleetList } from "./fleet-list";
import { MachineInspector } from "./machine-inspector";
import { TimelineBar } from "./timeline-bar";
import { TwinViewport } from "@/components/twin/twin-viewport";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { AlertCard } from "@/components/alerts/alert-card";
import { KpiRail, type KpiItem } from "@/components/ui/data";
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

  /** The right-hand column shows the selected machine or the site assistant, not both at once. */
  const [rightTab, setRightTab] = React.useState<"inspector" | "assistant">("inspector");

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

      {/* Primary workspace: fleet -> site/3D view -> inspector. This row gets
          the majority of the vertical space; the site view is the dominant
          column and is visible the moment the page loads. */}
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
            "shrink-0 transition-[width] max-lg:w-full lg:w-52",
            pane === "fleet" ? "flex" : "hidden lg:flex",
            !railOpen && "xl:w-0 xl:overflow-hidden xl:border-0",
          )}
        />

        {/* Twin */}
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
        </div>

        {/* Inspector / assistant — one column, one bordered container */}
        <div
          className={cn(
            "shrink-0 flex-col border-l border-white/10 bg-ink-900 max-lg:w-full lg:flex lg:w-72 2xl:w-80",
            pane === "inspector" ? "flex" : "hidden lg:flex",
          )}
        >
          <div className="flex shrink-0 items-center gap-1 border-b border-white/10 p-1.5">
            {(
              [
                { id: "inspector" as const, label: "Inspector", icon: SlidersHorizontal },
                { id: "assistant" as const, label: "Assistant", icon: MessageCircle },
              ]
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setRightTab(id)}
                aria-pressed={rightTab === id}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider transition-colors",
                  rightTab === id ? "bg-cat-500 text-ink-950" : "text-muted hover:bg-white/5 hover:text-zinc-200",
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>

          {rightTab === "inspector" ? (
            <MachineInspector
              machine={selected}
              alerts={alerts}
              onAcknowledge={acknowledge}
              className="min-h-0 flex-1 border-0"
            />
          ) : (
            <AssistantPanel surface="command" machineId={selected?.id} className="min-h-0 flex-1 rounded-none border-0" />
          )}
        </div>
      </div>

      {/* Timeline — full width, directly under the workspace */}
      <TimelineBar now={snapshot.t} markers={markers} replayAt={replayAt} onReplayAtChange={setReplayAt} />

      {/* Alerts as popups: nothing on-screen when the site is nominal, so the
          workspace never loses space to an empty panel. An open alert floats
          over the workspace until it is acknowledged, then it's gone. */}
      <div className="pointer-events-none fixed right-3 top-15 z-40 flex w-90 flex-col gap-2" aria-label="Active alerts">
        {openAlerts.length > 1 ? (
          <div className="pointer-events-auto flex items-center justify-between gap-2 rounded border border-white/10 bg-ink-900/95 px-3 py-1.5 shadow-lg">
            <span className="text-[11px] font-semibold text-zinc-300">{openAlerts.length} alerts awaiting acknowledgement</span>
            <Button variant="outline" size="sm" onClick={acknowledgeAll}>
              Acknowledge all
            </Button>
          </div>
        ) : null}
        <AnimatePresence initial={false}>
          {openAlerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              onAcknowledge={acknowledge}
              onSelect={(x) => setSelectedId(x.machineId)}
              compact
              className="pointer-events-auto shadow-lg"
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
