"use client";

/**
 * Rolling site event log. The engine only emits on state transitions, so this
 * stays readable instead of scrolling constantly.
 */

import { AnimatePresence, motion } from "motion/react";
import type { AlertSeverity } from "@/types/twin";
import { useTwinStore } from "@/store/twinStore";

const TONE: Record<AlertSeverity, { text: string; rail: string; mark: string }> = {
  info: { text: "text-zinc-300", rail: "bg-white/20", mark: "·" },
  warning: { text: "text-status-warn", rail: "bg-status-warn", mark: "▲" },
  critical: { text: "text-status-crit", rail: "bg-status-crit", mark: "■" },
};

export function EventFeed() {
  const events = useTwinStore((s) => s.snapshot.events);

  return (
    <section aria-label="Site event feed" className="panel pointer-events-auto w-[248px] p-3">
      <header className="flex items-center justify-between border-b border-white/10 pb-2">
        <span className="label-xs">Event feed</span>
        <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-status-ok" />
          LIVE
        </span>
      </header>

      <ol className="mt-2 max-h-[228px] space-y-0 overflow-hidden">
        <AnimatePresence initial={false}>
          {events.slice(0, 9).map((event) => {
            const tone = TONE[event.severity];
            return (
              <motion.li
                key={event.id}
                layout
                initial={{ opacity: 0, x: -10, height: 0 }}
                animate={{ opacity: 1, x: 0, height: "auto" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.22 }}
                className="flex gap-2 overflow-hidden py-1"
              >
                <span className={`mt-1 w-0.5 shrink-0 self-stretch rounded ${tone.rail}`} />
                <div className="min-w-0">
                  <div className="font-mono text-[10px] leading-none text-zinc-500">
                    {event.time}
                  </div>
                  <div className={`mt-0.5 text-[11px] leading-snug ${tone.text}`}>
                    {event.severity !== "info" ? (
                      <span className="mr-1 text-[9px]">{tone.mark}</span>
                    ) : null}
                    {event.text}
                  </div>
                </div>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </section>
  );
}
