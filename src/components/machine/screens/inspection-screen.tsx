"use client";

import { motion } from "motion/react";
import { Check, CircleAlert, RotateCcw, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { playAlertSound } from "@/lib/alert-sound";
import { inspectionSteps } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { useMachineStore } from "@/store/machine-store";
import { MachineSilhouette } from "../machine-visualization";
import { ScreenPad, TouchButton } from "../touch";
import type { MachineScreen } from "../machine-app";

export function InspectionScreen({ navigate }: { navigate: (s: MachineScreen) => void }) {
  const index = useMachineStore((s) => s.inspectionIndex);
  const results = useMachineStore((s) => s.inspectionResults);
  const record = useMachineStore((s) => s.recordInspection);
  const reset = useMachineStore((s) => s.resetInspection);

  const done = index >= inspectionSteps.length;
  const step = done ? null : inspectionSteps[index];
  const issues = Object.values(results).filter((r) => r === "issue").length;
  const skipped = Object.values(results).filter((r) => r === "skip").length;

  if (done) {
    return (
      <ScreenPad className="flex h-full items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-2xl rounded border-2 border-status-ok/40 bg-ink-900 p-8 text-center"
        >
          <span className="mx-auto flex size-20 items-center justify-center rounded-full bg-status-ok text-ink-950">
            <Check className="size-10" aria-hidden />
          </span>
          <h2 className="mt-5 text-3xl font-black uppercase tracking-[0.08em] text-zinc-50">
            Daily inspection complete
          </h2>
          <p className="mt-2 text-lg text-zinc-300">
            {issues > 0
              ? `${issues} issue${issues > 1 ? "s" : ""} reported to the maintenance team.`
              : "Machine is ready for operation."}
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3 text-left">
            {[
              { label: "Passed", value: Object.values(results).filter((r) => r === "pass").length, tone: "text-status-ok" },
              { label: "Issues", value: issues, tone: "text-status-crit" },
              { label: "Skipped", value: skipped, tone: "text-status-warn" },
            ].map((s) => (
              <div key={s.label} className="rounded border border-white/10 bg-ink-850 p-4">
                <p className="label-xs">{s.label}</p>
                <p className={cn("font-mono text-3xl font-bold", s.tone)}>{s.value}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <TouchButton tone="primary" full onClick={() => navigate("home")}>
              Return to home
            </TouchButton>
            <TouchButton full icon={<RotateCcw className="size-5" />} onClick={reset}>
              Run again
            </TouchButton>
          </div>
        </motion.div>
      </ScreenPad>
    );
  }

  return (
    <ScreenPad className="space-y-4">
      <div className="flex items-center gap-2">
        {inspectionSteps.map((s, i) => (
          <div key={s.id} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "h-2 flex-1 rounded-full",
                i < index ? "bg-status-ok" : i === index ? "bg-cat-500" : "bg-white/10",
              )}
            />
          </div>
        ))}
      </div>
      <p className="text-sm font-bold uppercase tracking-[0.18em] text-muted">
        Step {index + 1} of {inspectionSteps.length}
      </p>

      <motion.div
        key={step!.id}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        className="grid gap-5 rounded border border-white/10 bg-ink-900 p-5 xl:grid-cols-[1fr_1.1fr]"
      >
        <div className="flex items-center justify-center rounded border border-white/10 bg-ink-850 p-6">
          <div className="h-48 w-full text-cat-500">
            <MachineSilhouette shape={step!.shape} />
          </div>
        </div>

        <div className="flex flex-col">
          <h2 className="text-2xl font-black uppercase tracking-[0.04em] text-zinc-50">{step!.title}</h2>
          <p className="mt-3 text-lg leading-relaxed text-zinc-300">{step!.instruction}</p>
          <ul className="mt-4 space-y-2">
            {step!.checkpoints.map((c) => (
              <li key={c} className="flex items-center gap-3 rounded bg-white/4 px-4 py-3 text-base text-zinc-200">
                <span className="size-2 rounded-full bg-cat-500" />
                {c}
              </li>
            ))}
          </ul>

          <div className="mt-auto grid gap-3 pt-6 sm:grid-cols-3">
            <TouchButton
              tone="ok"
              full
              icon={<Check className="size-6" />}
              onClick={() => {
                record(step!.id, "pass");
                toast.success(`${step!.title} — passed`);
              }}
            >
              Pass
            </TouchButton>
            <TouchButton
              tone="crit"
              full
              icon={<CircleAlert className="size-6" />}
              onClick={() => {
                record(step!.id, "issue");
                toast.error(`Issue logged for ${step!.title.toLowerCase()}`);
                playAlertSound("warning");
              }}
            >
              Issue found
            </TouchButton>
            <TouchButton full icon={<SkipForward className="size-6" />} onClick={() => record(step!.id, "skip")}>
              Skip
            </TouchButton>
          </div>
        </div>
      </motion.div>
    </ScreenPad>
  );
}
