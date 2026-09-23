"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Circle, Mic, Sparkles } from "lucide-react";
import { assistantChecks } from "@/lib/mock-data";
import { deriveAdvice } from "@/lib/advice";
import { cn } from "@/lib/utils";
import { useMachineStore } from "@/store/machine-store";
import { AssistantCard, ScreenPad, SectionTitle, TouchButton } from "../touch";
import type { MachineScreen } from "../machine-app";

interface Turn {
  role: "operator" | "assistant";
  text: string;
}

const SCRIPTED_QUESTION = "Why is the hydraulic warning active?";

export function AssistantScreen({ navigate }: { navigate: (s: MachineScreen) => void }) {
  const sensors = useMachineStore((s) => s.sensors);
  const voiceState = useMachineStore((s) => s.voiceState);
  const setVoiceState = useMachineStore((s) => s.setVoiceState);
  const inspectionResults = useMachineStore((s) => s.inspectionResults);
  const advice = deriveAdvice(sensors);

  const [transcript, setTranscript] = React.useState<Turn[]>([]);
  const timers = React.useRef<number[]>([]);

  React.useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const answer = React.useCallback(() => {
    const temp = sensors.hydraulicTemperature.toFixed(0);
    const delta = Math.max(0, sensors.hydraulicTemperature - 90).toFixed(0);
    return sensors.hydraulicTemperature >= 90
      ? `Hydraulic temperature is currently ${temp}°C, approximately ${delta}°C above the recommended operating range. Reduce continuous high-load work and the system should recover within a few minutes.`
      : `No hydraulic warning is active. Hydraulic oil is ${temp}°C and system pressure is ${Math.round(sensors.hydraulicPressure).toLocaleString()} PSI, both inside the normal range.`;
  }, [sensors]);

  const runVoiceDemo = () => {
    if (voiceState !== "idle") return;
    timers.current.forEach(window.clearTimeout);
    setTranscript([]);
    setVoiceState("listening");
    timers.current = [
      window.setTimeout(() => {
        setTranscript([{ role: "operator", text: SCRIPTED_QUESTION }]);
        setVoiceState("thinking");
      }, 1800),
      window.setTimeout(() => {
        setVoiceState("responding");
        setTranscript((t) => [...t, { role: "assistant", text: answer() }]);
      }, 3200),
      window.setTimeout(() => setVoiceState("idle"), 6200),
    ];
  };

  const checks = assistantChecks.map((c) =>
    c.label.toLowerCase().includes("track")
      ? { ...c, done: Boolean(inspectionResults["tracks"]) }
      : c,
  );
  const remaining = checks.filter((c) => !c.done).length;

  const voiceLabel = {
    idle: "Tap to speak",
    listening: "Listening…",
    thinking: "Thinking…",
    responding: "Responding…",
  }[voiceState];

  return (
    <ScreenPad className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
      <section className="space-y-4">
        <div className="rounded border border-white/10 bg-ink-900 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded bg-cat-500 text-ink-950">
              <Sparkles className="size-6" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Machine Assistant</p>
              <p className="text-xl font-bold text-zinc-50">Good morning, Operator.</p>
            </div>
          </div>
          <p className="mt-3 text-base text-zinc-300">
            {remaining === 0
              ? "All pre-start checks are complete. Your machine is ready for operation."
              : "Your machine is ready for operation. One walkaround check is still outstanding."}
          </p>

          <div className="mt-5">
            <SectionTitle right={<span className="text-xs text-muted">{checks.length - remaining}/{checks.length} done</span>}>
              Today&apos;s checks
            </SectionTitle>
            <ul className="space-y-2">
              {checks.map((c) => (
                <li
                  key={c.label}
                  className={cn(
                    "flex min-h-14 items-center gap-3 rounded border px-4",
                    c.done ? "border-status-ok/40 bg-status-ok/8" : "border-white/12 bg-white/4",
                  )}
                >
                  {c.done ? (
                    <Check className="size-5 text-status-ok" aria-hidden />
                  ) : (
                    <Circle className="size-5 text-muted" aria-hidden />
                  )}
                  <span className="text-base font-semibold text-zinc-100">{c.label}</span>
                  <span className={cn("ml-auto text-xs font-bold uppercase tracking-widest", c.done ? "text-status-ok" : "text-muted")}>
                    {c.done ? "Complete" : "Pending"}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <TouchButton tone="primary" full className="mt-5" onClick={() => navigate("inspection")}>
            Start daily inspection
          </TouchButton>
        </div>

        <div className="rounded border border-white/10 bg-ink-900 p-5">
          <SectionTitle>Voice</SectionTitle>
          <div className="flex items-center gap-5">
            <button
              onClick={runVoiceDemo}
              aria-label="Ask the machine assistant"
              className={cn(
                "relative flex size-20 shrink-0 items-center justify-center rounded-full transition-colors",
                voiceState === "idle" ? "bg-white/8 text-zinc-200 hover:bg-white/14" : "bg-cat-500 text-ink-950",
              )}
            >
              <Mic className="size-8" aria-hidden />
              {voiceState === "listening" ? (
                <motion.span
                  className="absolute inset-0 rounded-full border-2 border-cat-500"
                  animate={{ scale: [1, 1.35], opacity: [0.8, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                />
              ) : null}
            </button>
            <div className="min-w-0">
              <p className="text-lg font-bold uppercase tracking-[0.12em] text-zinc-100">{voiceLabel}</p>
              <p className="mt-1 text-sm text-muted">
                Voice recognition is simulated for this prototype. Tap the microphone to replay a sample exchange.
              </p>
            </div>
          </div>

          <div className="mt-4 min-h-[120px] space-y-2">
            <AnimatePresence>
              {transcript.map((t, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "rounded px-4 py-3 text-base",
                    t.role === "operator"
                      ? "bg-white/6 text-zinc-200"
                      : "border border-cat-500/30 bg-cat-500/8 text-zinc-100",
                  )}
                >
                  <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
                    {t.role === "operator" ? "Operator" : "Assistant"}
                  </span>
                  {t.text}
                </motion.div>
              ))}
            </AnimatePresence>
            {voiceState === "thinking" ? (
              <div className="flex gap-1.5 px-2">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="size-2.5 rounded-full bg-cat-500"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Operational guidance</SectionTitle>
        {advice.map((a) => (
          <AssistantCard key={a.id} severity={a.severity} title={a.title} body={a.body} />
        ))}
        <TouchButton full onClick={() => navigate("alerts")}>
          View all alerts
        </TouchButton>
      </section>
    </ScreenPad>
  );
}
