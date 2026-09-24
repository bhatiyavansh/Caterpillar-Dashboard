"use client";

/**
 * Operator HMI.
 *
 * Built for a 10-inch screen at arm's length in daylight, in gloves. Large
 * type, few surfaces, and one thing shouting at a time. Nothing here scrolls
 * on a normal cab display: the operator must be able to take it all in at a
 * glance and get back to the controls.
 */
import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Fuel, Gauge, Hourglass, Thermometer } from "lucide-react";
import { TaskPanel } from "./task-panel";
import { FrontCameraPanel, RearCameraPanel } from "./integration-slots";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { AlertRibbon, levelFor } from "@/components/alerts/alert-ribbon";
import { ArcGauge, Readout } from "@/components/ui/data";
import { MachineStatusChip } from "@/components/ui/status";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { LIMITS, MACHINE_STATUS, thresholdStatus } from "@/lib/status";
import { useAlerts, useMachine, useSnapshot, useTasks } from "@/lib/hooks/use-site";
import { PRIMARY_MACHINE_ID } from "@/lib/api/seed";
import { cn } from "@/lib/utils";

export function CabHmi() {
  const params = useSearchParams();
  const machineId = params.get("machine") ?? PRIMARY_MACHINE_ID;

  const snapshot = useSnapshot();
  const { data: machine, loading, error } = useMachine(machineId);
  const { data: alerts, acknowledge } = useAlerts({ machineId });
  const { data: tasks } = useTasks(machineId);
  const [cameraOn, setCameraOn] = React.useState(true);

  // Site-wide advisories (weather) belong in the cab too.
  const siteAlerts = React.useMemo(
    () => (snapshot?.alerts ?? []).filter((a) => a.machineId === "SITE"),
    [snapshot],
  );
  const cabAlerts = React.useMemo(() => [...alerts, ...siteAlerts], [alerts, siteAlerts]);

  if (loading) return <LoadingState label="Connecting to the machine…" className="h-full" />;
  if (error || !machine)
    return (
      <ErrorState
        title="Machine not reporting"
        body={error ?? `${machineId} is not sending telemetry. Check the machine is powered and in range.`}
        className="h-full"
      />
    );

  const level = levelFor(cabAlerts);

  const fuelStatus = thresholdStatus(machine.fuel, LIMITS.fuel);
  const tempStatus = thresholdStatus(machine.hydraulicTemperature, LIMITS.hydraulicTemperature);
  const tipStatus = thresholdStatus(machine.tipOverMargin, LIMITS.tipOverMargin);
  const token = MACHINE_STATUS[machine.status];

  return (
    <div
      className={cn(
        // At cab resolution everything fits without scrolling, which is the
        // point: the operator takes it in at a glance. On a narrow screen the
        // three panels stack, so the page has to be allowed to scroll rather
        // than crush them into unreadable slivers.
        "flex h-full flex-col gap-2.5 overflow-y-auto p-2.5 transition-colors duration-500 lg:min-h-0 lg:overflow-hidden",
        level === "critical" && "bg-status-crit/[0.07]",
      )}
    >
      {/* Machine identity bar */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 rounded border border-white/10 bg-ink-850 px-4 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <span className="font-mono text-2xl font-bold leading-none text-zinc-50">{machine.id}</span>
          <span className="text-xs text-muted">{machine.model}</span>
        </div>
        <MachineStatusChip status={machine.status} size="lg" soundKey={machine.id} />
        <div className="hidden sm:block">
          <p className="label-xs">Operator</p>
          <p className="text-sm font-semibold text-zinc-100">
            {machine.operator?.name ?? "Unassigned"}
            <span className="ml-1.5 font-mono text-xs text-muted">{machine.operator?.id}</span>
          </p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-right">
            <span className="label-xs block">Seatbelt</span>
            <span
              className={cn(
                "block text-sm font-bold uppercase",
                machine.seatbelt === "unfastened" ? "text-status-crit" : "text-status-ok",
              )}
            >
              {machine.seatbelt === "unfastened" ? "Unfastened" : "Fastened"}
            </span>
          </span>
          <span className="hidden text-right md:block">
            <span className="label-xs block">Shift clock</span>
            <span className="block font-mono text-sm font-bold tabular-nums text-zinc-100">
              {snapshot?.clock ?? "--:--:--"}
            </span>
          </span>
        </div>
      </header>

      {/* Alert ribbon — always present, changes character rather than appearing */}
      <AlertRibbon
        alerts={cabAlerts}
        onAcknowledge={acknowledge}
        restingMessage="All systems normal"
        size="cab"
        className="shrink-0"
      />

      {/* Working area */}
      <div className="grid flex-1 gap-2.5 max-lg:shrink-0 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)_minmax(0,0.85fr)]">
        <TaskPanel tasks={tasks} className="min-h-0" />

        {/* Machine health */}
        <section
          className="flex min-h-0 flex-col overflow-hidden rounded border border-white/10 bg-ink-850"
          aria-label="Machine health"
        >
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <span className="label-xs">Machine health</span>
            <span className={cn("text-[10px] font-bold uppercase tracking-wider", token.text)}>{token.label}</span>
          </div>

          <div className="grid grid-cols-3 gap-1 px-2 py-3">
            <ArcGauge label="Fuel" value={machine.fuel} min={0} max={100} unit="%" status={fuelStatus} limit={LIMITS.fuel.warn} size={104} />
            <ArcGauge
              label="Hydraulic"
              value={machine.hydraulicTemperature}
              min={40}
              max={120}
              unit="°C"
              status={tempStatus}
              limit={LIMITS.hydraulicTemperature.warn}
              size={104}
            />
            <ArcGauge
              label="Tip-over"
              value={machine.tipOverMargin}
              min={1}
              max={3}
              status={tipStatus}
              decimals={2}
              limit={LIMITS.tipOverMargin.crit}
              size={104}
            />
          </div>

          <dl className="mt-auto divide-y divide-white/5 border-t border-white/10 px-4 py-1">
            <Readout label="Engine hours" value={machine.engineHours.toFixed(1)} unit="h" />
            <Readout label="Load" value={machine.load} unit="%" hint={`${machine.payloadKg.toLocaleString("en-IN")} kg`} />
            <Readout
              label="Idle this shift"
              value={machine.idleMinutes.toFixed(0)}
              unit="min"
              status={thresholdStatus(machine.idleMinutes, { warn: 60, crit: 90 })}
            />
            <Readout label="Load cycles" value={machine.loadCycles} />
          </dl>

          {/* Glanceable icon strip for the things that stop work */}
          <div className="grid grid-cols-4 border-t border-white/10 text-center">
            {[
              { icon: Fuel, label: "Fuel", status: fuelStatus },
              { icon: Thermometer, label: "Temp", status: tempStatus },
              { icon: Gauge, label: "Stability", status: tipStatus },
              { icon: Hourglass, label: "Service", status: "operating" as const },
            ].map(({ icon: Icon, label, status }) => (
              <div key={label} className={cn("flex flex-col items-center gap-0.5 py-2", MACHINE_STATUS[status].text)}>
                <Icon className="size-4" aria-hidden />
                <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Assistant + two cameras */}
        <div className="flex min-h-0 flex-col gap-2.5">
          <div className="grid shrink-0 grid-cols-2 gap-2.5">
            <RearCameraPanel
              machineId={machine.id}
              level={machine.proximity.level}
              distanceM={machine.proximity.nearestPersonM}
              zone={machine.proximity.zone}
              cameraOn={cameraOn}
              onToggleCamera={() => setCameraOn((v) => !v)}
            />
            <FrontCameraPanel machineId={machine.id} cameraOn={cameraOn} onToggleCamera={() => setCameraOn((v) => !v)} />
          </div>
          <AssistantPanel
            surface="cab"
            machineId={machine.id}
            operatorId={machine.operator?.id}
            alert={level === "critical"}
            className="min-h-0 flex-1"
          />
        </div>
      </div>
    </div>
  );
}
