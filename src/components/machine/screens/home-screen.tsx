"use client";

import { Droplets, Flame, Gauge, ShieldAlert, Timer, Waves } from "lucide-react";
import { deriveAdvice } from "@/lib/advice";
import { formatNumber } from "@/lib/utils";
import { lowReadingStatus, readingStatus, SEATBELT_ALERT_ID, useMachineStore } from "@/store/machine-store";
import { MachineVisualization, type MachinePart } from "../machine-visualization";
import { AssistantCard, MachineStatusCard, ScreenPad, SectionTitle, TouchButton } from "../touch";
import type { MachineScreen } from "../machine-app";
import { useState } from "react";
import { PART_INFO } from "../machine-visualization";

export function HomeScreen({ navigate }: { navigate: (s: MachineScreen) => void }) {
  const s = useMachineStore((st) => st.sensors);
  const seatbeltFastened = useMachineStore((st) => st.seatbeltFastened);
  const seatbeltAlert = useMachineStore((st) => st.alerts.find((a) => a.id === SEATBELT_ALERT_ID));
  const [part, setPart] = useState<MachinePart | null>(null);
  const advice = deriveAdvice(s).slice(0, 2);

  const engineStatus = readingStatus(s.engineTemperature, 92, 104);
  const hydStatus = readingStatus(s.hydraulicTemperature, 90, 100);
  const fuelStatus = lowReadingStatus(s.fuelLevel, 20, 10);
  // Read off the same alert the store derived, rather than re-deriving the
  // escalation here — one clock, one place it can disagree with itself.
  const seatbeltStatus = seatbeltAlert ? (seatbeltAlert.severity === "critical" ? "critical" : "warning") : "healthy";

  return (
    <ScreenPad className="space-y-5">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MachineStatusCard
          label="Engine"
          value={s.engineTemperature.toFixed(0)}
          unit="°C"
          sub={`${formatNumber(s.rpm)} RPM`}
          status={engineStatus}
          icon={<Flame className="size-6" />}
          onClick={() => navigate("status")}
        />
        <MachineStatusCard
          label="Fuel"
          value={s.fuelLevel.toFixed(0)}
          unit="%"
          sub={`${s.fuelLitres.toFixed(0)} L`}
          status={fuelStatus}
          icon={<Droplets className="size-6" />}
          onClick={() => navigate("status")}
        />
        <MachineStatusCard
          label="Hydraulics"
          value={formatNumber(s.hydraulicPressure)}
          unit="PSI"
          sub={`${s.hydraulicTemperature.toFixed(0)} °C oil`}
          status={hydStatus}
          icon={<Waves className="size-6" />}
          onClick={() => navigate("performance")}
        />
        <MachineStatusCard
          label="Operating hours"
          value={formatNumber(s.operatingHours, 0)}
          unit="h"
          sub="Service in 42 h"
          icon={<Timer className="size-6" />}
          onClick={() => navigate("performance")}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <section className="rounded border border-white/10 bg-ink-900 p-4">
          <SectionTitle right={<span className="text-xs text-muted">Touch a component</span>}>
            Machine overview
          </SectionTitle>
          <div className="h-64 xl:h-72">
            <MachineVisualization
              selected={part}
              onSelect={setPart}
              partStatus={{ engine: engineStatus, hydraulics: hydStatus }}
            />
          </div>
          <div className="mt-3 min-h-[92px] rounded border border-white/10 bg-ink-850 p-3">
            {part ? (
              <>
                <p className="text-sm font-bold uppercase tracking-[0.14em] text-cat-500">{PART_INFO[part].title}</p>
                <p className="mt-1 text-sm text-zinc-400">{PART_INFO[part].description}</p>
                <div className="mt-2 flex flex-wrap gap-4">
                  {PART_INFO[part].readings.map((r) => (
                    <span key={r.label} className="text-sm">
                      <span className="text-muted">{r.label}: </span>
                      <span className="font-mono font-semibold text-zinc-100">{r.value}</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                Select the engine, hydraulic arm, tracks or cabin on the diagram to read that system.
              </p>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded border border-white/10 bg-ink-900 p-4">
            <SectionTitle>Assistant</SectionTitle>
            <p className="text-lg font-semibold text-zinc-100">Good morning, Operator.</p>
            <p className="mt-1 text-sm text-zinc-400">Your machine is ready for operation.</p>
            <div className="mt-4 grid gap-2">
              <TouchButton tone="primary" full onClick={() => navigate("assistant")}>
                Machine Assistant
              </TouchButton>
              <TouchButton full onClick={() => navigate("inspection")}>
                Start daily inspection
              </TouchButton>
            </div>
          </div>

          <div className="space-y-3">
            <SectionTitle>Now</SectionTitle>
            {advice.map((a) => (
              <AssistantCard key={a.id} severity={a.severity} title={a.title} body={a.body} />
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <MachineStatusCard
          label="Seatbelt"
          value={seatbeltFastened ? "Fastened" : "Unfastened"}
          status={seatbeltStatus}
          icon={<ShieldAlert className="size-6" />}
          onClick={() => navigate("alerts")}
        />
        <MachineStatusCard label="Battery" value={s.battery.toFixed(0)} unit="%" status={lowReadingStatus(s.battery, 40, 20)} icon={<Gauge className="size-6" />} />
        <MachineStatusCard label="DEF" value={s.defLevel.toFixed(0)} unit="%" status={lowReadingStatus(s.defLevel, 20, 10)} icon={<Droplets className="size-6" />} />
        <MachineStatusCard label="Ground speed" value={s.machineSpeed.toFixed(1)} unit="km/h" sub={`${s.engineLoad.toFixed(0)}% load`} icon={<Gauge className="size-6" />} />
      </div>
    </ScreenPad>
  );
}
