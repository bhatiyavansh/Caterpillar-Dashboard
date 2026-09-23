"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Circle, Mic, Send, Sparkles } from "lucide-react";
import { useVoice } from "@web/lib/voice";
import { assistantChecks } from "@/lib/mock-data";
import { deriveAdvice } from "@/lib/advice";
import { PRIMARY_MACHINE_ID } from "@/lib/api/seed";
import { cn } from "@/lib/utils";
import { useMachineStore } from "@/store/machine-store";
import { AssistantCard, ScreenPad, SectionTitle, TouchButton } from "../touch";
import type { MachineScreen } from "../machine-app";

/** Shown as tappable chips so the cab is usable with gloves on, not just by voice. */
const SUGGESTIONS = [
  "Why is the hydraulic warning active?",
  "Is my seatbelt fastened?",
  "How long will this task take?",
  "What should I do about the proximity alert?",
];

export function AssistantScreen({ navigate }: { navigate: (s: MachineScreen) => void }) {
  const sensors = useMachineStore((s) => s.sensors);
  const setVoiceState = useMachineStore((s) => s.setVoiceState);
  const inspectionResults = useMachineStore((s) => s.inspectionResults);
  const advice = deriveAdvice(sensors);

  const voice = useVoice({ surface: "cab", machineId: PRIMARY_MACHINE_ID });
  const [input, setInput] = React.useState("");
  const logRef = React.useRef<HTMLDivElement>(null);

  // Keep the cab's own HMI animation (mic ring, avatar) in step with the real
  // assistant rather than with a scripted timer.
  React.useEffect(() => {
    setVoiceState(
      voice.listening ? "listening"
        : voice.status === "thinking" || voice.status === "calling_tool" || voice.transcribing ? "thinking"
        : voice.speaking || voice.status === "answering" ? "responding"
        : "idle",
    );
  }, [voice.listening, voice.transcribing, voice.speaking, voice.status, setVoiceState]);

  React.useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [voice.messages.length, voice.draft]);

  const submit = (text: string) => {
    if (!text.trim()) return;
    setInput("");
    void voice.send(text);
  };

  const checks = assistantChecks.map((c) =>
    c.label.toLowerCase().includes("track")
      ? { ...c, done: Boolean(inspectionResults["tracks"]) }
      : c,
  );
  const remaining = checks.filter((c) => !c.done).length;

  const busy = voice.status === "thinking" || voice.status === "calling_tool" || voice.status === "answering";
  const voiceLabel = voice.listening
    ? "Listening…"
    : voice.transcribing
      ? "Transcribing…"
      : voice.status === "calling_tool"
        ? "Checking the machine…"
        : voice.status === "thinking"
          ? "Thinking…"
          : voice.speaking
            ? "Responding…"
            : voice.sttSupported
              ? "Hold to speak"
              : "Type your question";

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
          <SectionTitle>Ask the assistant</SectionTitle>
          <div className="flex items-center gap-5">
            <button
              onPointerDown={voice.startTalking}
              onPointerUp={voice.stopTalking}
              onPointerLeave={voice.stopTalking}
              disabled={!voice.sttSupported}
              aria-label="Hold to ask the machine assistant"
              className={cn(
                "relative flex size-20 shrink-0 items-center justify-center rounded-full transition-colors",
                voice.listening ? "bg-cat-500 text-ink-950" : "bg-white/8 text-zinc-200 hover:bg-white/14",
                !voice.sttSupported && "cursor-not-allowed opacity-40",
              )}
            >
              <Mic className="size-8" aria-hidden />
              {voice.listening ? (
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
                {voice.interim
                  ? voice.interim
                  : voice.sttSupported
                    ? `Hold the microphone and ask anything about this machine or the site (${voice.sttEngine} speech).`
                    : "Speech is unavailable in this browser. Type your question instead."}
              </p>
            </div>
          </div>

          {voice.micError ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-status-warn">
              <AlertTriangle className="size-4" aria-hidden />
              {voice.micError}
            </p>
          ) : null}

          <div ref={logRef} className="mt-4 max-h-[280px] min-h-[120px] space-y-2 overflow-y-auto">
            <AnimatePresence initial={false}>
              {voice.messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "rounded px-4 py-3 text-base",
                    m.role === "user"
                      ? "bg-white/6 text-zinc-200"
                      : "border border-cat-500/30 bg-cat-500/8 text-zinc-100",
                  )}
                >
                  <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">
                    {m.role === "user" ? "Operator" : "Assistant"}
                  </span>
                  {m.text}
                  {/* Say where the answer came from, rather than letting a cached or
                      fallback answer pass as a live one. */}
                  {m.role === "assistant" && m.mode && m.mode !== "live" ? (
                    <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted">
                      {m.mode === "cache" ? "cached" : "from data"}
                    </span>
                  ) : null}
                </motion.div>
              ))}
            </AnimatePresence>

            {voice.draft ? (
              <div className="rounded border border-cat-500/30 bg-cat-500/8 px-4 py-3 text-base text-zinc-100">
                <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.18em] text-muted">Assistant</span>
                {voice.draft}
              </div>
            ) : null}

            {busy && !voice.draft ? (
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

            {voice.error ? (
              <p className="px-2 text-sm text-status-warn">{voice.error}</p>
            ) : null}
          </div>

          {/* A pending action never executes on the model's say-so; the operator confirms. */}
          {voice.pending.map((p) => (
            <div key={p.action_id} className="mt-3 rounded border border-status-warn/40 bg-status-warn/8 p-4">
              <p className="text-base font-semibold text-zinc-100">{p.summary}</p>
              <div className="mt-3 flex gap-2">
                <TouchButton tone="primary" onClick={() => void voice.confirm(p.action_id)}>
                  Confirm
                </TouchButton>
                <TouchButton onClick={() => void voice.cancel(p.action_id)}>Cancel</TouchButton>
              </div>
            </div>
          ))}

          {voice.messages.length === 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="rounded border border-white/12 bg-white/4 px-3 py-2 text-sm text-zinc-300 hover:bg-white/10"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}

          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about this machine or the site…"
              aria-label="Ask the machine assistant"
              className="min-h-14 flex-1 rounded border border-white/12 bg-white/4 px-4 text-base text-zinc-100 placeholder:text-muted focus:border-cat-500 focus:outline-none"
            />
            <TouchButton tone="primary" type="submit" disabled={!input.trim() || busy}>
              <Send className="size-5" aria-hidden />
            </TouchButton>
          </form>
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
