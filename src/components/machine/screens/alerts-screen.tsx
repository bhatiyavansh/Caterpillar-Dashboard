"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { deriveAdvice } from "@/lib/advice";
import type { Severity } from "@/lib/types";
import { cn, severityStyles } from "@/lib/utils";
import { PRIMARY_MACHINE_ID } from "@/lib/mock-data";
import { useMachineStore } from "@/store/machine-store";
import { EmptyState } from "@/components/ui/primitives";
import { ScreenPad, SectionTitle, TouchButton } from "../touch";
import type { MachineScreen } from "../machine-app";

/** The reading a temperature-based advisory is about, for the numeric panel. */
const READING_FOR: Record<string, { label: string; unit: string; limit: string; read: (s: { hydraulicTemperature: number; engineTemperature: number }) => number }> = {
  "hyd-crit": { label: "Hydraulic temperature", unit: "°C", limit: "< 90°C", read: (s) => s.hydraulicTemperature },
  "hyd-warn": { label: "Hydraulic temperature", unit: "°C", limit: "< 90°C", read: (s) => s.hydraulicTemperature },
  "eng-crit": { label: "Engine temperature", unit: "°C", limit: "< 92°C", read: (s) => s.engineTemperature },
  "eng-warn": { label: "Engine temperature", unit: "°C", limit: "< 92°C", read: (s) => s.engineTemperature },
};

/**
 * One shape for the headline banner, whichever of the two sources it came
 * from. `alerts` (seatbelt, seeded faults) and live sensor advisories used to
 * be handled as two unrelated lists, so a seatbelt alert could sit in the log
 * below and never become the thing the big banner points at — the one place
 * an operator glancing at the screen would actually see it.
 */
interface Headline {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  reading?: { label: string; value: string; limit: string };
}

export function AlertsScreen({ navigate }: { navigate: (s: MachineScreen) => void }) {
  const sensors = useMachineStore((s) => s.sensors);
  const alerts = useMachineStore((s) => s.alerts);
  const acknowledge = useMachineStore((s) => s.acknowledgeAlert);
  const [ackLive, setAckLive] = React.useState<string[]>([]);

  const liveAdvice = deriveAdvice(sensors).filter((a) => a.severity !== "info" && !ackLive.includes(a.id));
  const machineAlerts = alerts.filter((a) => a.machineId === PRIMARY_MACHINE_ID);
  const openAlerts = machineAlerts.filter((a) => !a.acknowledged);

  const candidates: Headline[] = [
    ...openAlerts.map((a) => ({ id: a.id, severity: a.severity, title: a.title, body: a.recommendedAction })),
    ...liveAdvice.map((a) => ({
      id: a.id,
      severity: a.severity,
      title: a.title,
      body: a.body,
      reading: READING_FOR[a.id]
        ? {
            label: READING_FOR[a.id]!.label,
            value: `${READING_FOR[a.id]!.read(sensors).toFixed(0)}${READING_FOR[a.id]!.unit}`,
            limit: READING_FOR[a.id]!.limit,
          }
        : undefined,
    })),
  ];
  // Critical first, then warning — whichever is worst is what the operator
  // needs to see, not whichever source happened to update most recently.
  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  candidates.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const headline = candidates[0];

  return (
    <ScreenPad className="space-y-5">
      {headline ? (
        <section
          className={cn(
            "rounded border-2 p-6",
            severityStyles[headline.severity].border,
            severityStyles[headline.severity].bg,
          )}
        >
          <div className={cn("flex items-center gap-3", severityStyles[headline.severity].text)}>
            <TriangleAlert className="size-9" aria-hidden />
            <span className="text-2xl font-black uppercase tracking-[0.14em]">
              {headline.severity === "critical" ? "Critical" : "Warning"}
            </span>
          </div>
          <h2 className="mt-4 text-3xl font-black uppercase leading-tight tracking-[0.02em] text-zinc-50">
            {headline.title}
          </h2>

          {headline.reading ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded border border-white/10 bg-ink-900 p-4">
                <p className="label-xs">{headline.reading.label}</p>
                <p className="font-mono text-4xl font-bold text-zinc-50">{headline.reading.value}</p>
              </div>
              <div className="rounded border border-white/10 bg-ink-900 p-4">
                <p className="label-xs">Recommended</p>
                <p className="font-mono text-4xl font-bold text-status-ok">{headline.reading.limit}</p>
              </div>
            </div>
          ) : null}

          <div className="mt-4 rounded border border-white/10 bg-ink-900 p-4">
            <p className="label-xs">Recommended action</p>
            <p className="mt-1 text-lg text-zinc-200">{headline.body}</p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <TouchButton
              tone="primary"
              full
              onClick={() => {
                if (openAlerts.some((a) => a.id === headline.id)) {
                  acknowledge(headline.id);
                } else {
                  setAckLive((v) => [...v, headline.id]);
                }
                toast.success("Alert acknowledged");
              }}
            >
              Acknowledge
            </TouchButton>
            <TouchButton full onClick={() => navigate("status")}>
              View details
            </TouchButton>
          </div>
        </section>
      ) : (
        <EmptyState
          title="No active alerts"
          body="All monitored systems are reporting within their normal operating range."
          icon={<TriangleAlert className="size-8" />}
        />
      )}

      <section>
        <SectionTitle>Alert log</SectionTitle>
        <ul className="space-y-2">
          {machineAlerts.map((a) => {
            const s = severityStyles[a.severity];
            return (
              <li key={a.id} className={cn("rounded border p-4", s.border, "bg-ink-900")}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={cn("rounded px-2 py-1 text-xs font-black uppercase tracking-[0.14em]", s.bg, s.text)}>
                    {s.label}
                  </span>
                  <span className="text-base font-bold text-zinc-100">{a.title}</span>
                  <span className="ml-auto text-sm text-muted">{a.timestamp}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-400">{a.description}</p>
                <div className="mt-3 flex items-center gap-3">
                  {a.acknowledged ? (
                    <span className="text-xs font-bold uppercase tracking-widest text-status-ok">Acknowledged</span>
                  ) : (
                    <TouchButton className="min-h-12 px-4 text-sm" onClick={() => acknowledge(a.id)}>
                      Acknowledge
                    </TouchButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </ScreenPad>
  );
}
