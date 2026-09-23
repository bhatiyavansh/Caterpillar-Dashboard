"use client";

/**
 * Task column of the cab. The operator needs three things: what am I doing,
 * how far in am I, and what is next. Everything else is a distraction at the
 * controls.
 */
import * as React from "react";
import { ChevronRight, Clock } from "lucide-react";
import type { SiteTask } from "@/lib/api/contracts";
import { Button } from "@/components/ui/primitives";
import { EmptyPanel } from "@/components/ui/states";
import { cn } from "@/lib/utils";

function TaskDetail({ task, onClose }: { task: SiteTask; onClose: () => void }) {
  return (
    <div className="space-y-2 border-t border-white/10 bg-ink-900 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="label-xs">Estimated range</span>
        <span className="font-mono text-sm font-bold text-zinc-100">
          {task.etaRange[0]}–{task.etaRange[1]} min
        </span>
      </div>
      {task.reasons.length ? (
        <ul className="space-y-1">
          {task.reasons.map((r) => (
            <li key={r} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
              <ChevronRight className="mt-0.5 size-3 shrink-0 text-cat-500" aria-hidden />
              {r}
            </li>
          ))}
        </ul>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onClose} className="w-full">
        Hide details
      </Button>
    </div>
  );
}

export function TaskPanel({ tasks, className }: { tasks: SiteTask[]; className?: string }) {
  const [openDetail, setOpenDetail] = React.useState(false);

  const active = tasks.find((t) => t.state === "active") ?? null;
  const queued = tasks.filter((t) => t.state === "queued");
  const done = tasks.filter((t) => t.state === "done").length;

  if (!active && !queued.length) {
    return (
      <section className={cn("flex flex-col overflow-hidden rounded border border-white/10 bg-ink-850", className)}>
        <EmptyPanel
          title="No tasks assigned"
          body="The shift planner has not issued work for this machine yet. Contact the site office."
          className="flex-1"
        />
      </section>
    );
  }

  return (
    <section
      className={cn("flex min-h-0 flex-col overflow-hidden rounded border border-white/10 bg-ink-850", className)}
      aria-label="Shift tasks"
    >
      {active ? (
        <>
          <div className="border-b border-cat-500/30 bg-cat-500/8 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-cat-500">Now</span>
              <span className="text-[11px] text-muted">{active.zone}</span>
            </div>

            <h2 className="mt-1 text-xl font-bold leading-tight text-zinc-50">{active.title}</h2>

            <div className="mt-3 flex items-end justify-between gap-3">
              <span>
                <span className="block font-mono text-4xl font-bold leading-none text-cat-500 tabular-nums">
                  {Math.round(active.progress)}%
                </span>
                <span className="label-xs mt-1 block">Complete</span>
              </span>
              <span className="text-right">
                <span className="block font-mono text-2xl font-bold leading-none text-zinc-50 tabular-nums">
                  {active.etaMinutes}
                  <span className="ml-1 text-sm font-medium text-muted">min</span>
                </span>
                <span className="label-xs mt-1 block">Remaining</span>
              </span>
            </div>

            <div
              className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-black/40"
              role="progressbar"
              aria-label={`${active.title} progress`}
              aria-valuenow={Math.round(active.progress)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-cat-500 transition-[width] duration-700"
                style={{ width: `${active.progress}%` }}
              />
            </div>

            {!openDetail ? (
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setOpenDetail(true)}>
                View details
              </Button>
            ) : null}
          </div>

          {openDetail ? <TaskDetail task={active} onClose={() => setOpenDetail(false)} /> : null}
        </>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {queued.map((task, i) => (
          <div key={task.id} className="border-b border-white/5 px-4 py-2.5 last:border-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted">
                {i === 0 ? "Next" : "Later"}
              </span>
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-300">
                <Clock className="size-3 text-muted" aria-hidden />
                {task.startsAt}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm font-semibold text-zinc-100">{task.title}</p>
            <p className="truncate text-[11px] text-muted">
              {task.zone} · about {task.etaMinutes} min
              {task.reasons[0] ? ` · ${task.reasons[0]}` : ""}
            </p>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-white/10 px-4 py-2 text-[11px] text-muted">
        {done} done · {queued.length} remaining this shift
      </div>
    </section>
  );
}
