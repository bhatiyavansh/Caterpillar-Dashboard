"use client";

/**
 * The shift's work, with the model's estimate for each job.
 *
 * The estimate is the point of this screen, so it is shown the way a forecast
 * should be: a number, the band around it, and what moved it. A single figure
 * invites false confidence — "58 minutes" reads as a promise, "50–67, most
 * likely 58" reads as a forecast, which is what it is.
 *
 * The planner's own arithmetic sits alongside it deliberately. It is what the
 * site office would have written down, and the gap between the two is the whole
 * argument for the model being there at all.
 */
import * as React from "react";
import { motion } from "motion/react";
import { Clock, Gauge, TrendingDown, TrendingUp } from "lucide-react";
import type { EstimateDriver, SiteTask } from "@/lib/api/contracts";
import { taskTimeMetrics } from "@/lib/intel";
import { Progress } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const STATE_STYLE: Record<SiteTask["state"], { label: string; chip: string; bar: string }> = {
  active: { label: "In progress", chip: "bg-cat-500/15 text-cat-500", bar: "bg-cat-500" },
  queued: { label: "Queued", chip: "bg-white/8 text-muted", bar: "bg-zinc-600" },
  done: { label: "Complete", chip: "bg-status-ok/15 text-status-ok", bar: "bg-status-ok" },
};

const TASK_TYPE_LABEL: Record<SiteTask["taskType"], string> = {
  trenching: "Trenching",
  loading: "Loading",
  grading: "Grading",
  dozing: "Dozing",
  hauling: "Hauling",
};

/** "1 h 47 m" reads faster than "107 min" at a glance on a wide screen. */
function duration(minutes: number): string {
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h} h ${m} m` : `${h} h`;
}

/** One term of the estimate: which way it pushed, and by how much. */
function DriverChip({ driver }: { driver: EstimateDriver }) {
  const slower = driver.impactMin > 0;
  const Icon = slower ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium",
        slower
          ? "border-status-warn/35 bg-status-warn/10 text-status-warn"
          : "border-status-ok/35 bg-status-ok/10 text-status-ok",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {driver.label}
      <span className="font-mono font-bold tabular-nums">
        {slower ? "+" : "−"}
        {Math.abs(driver.impactMin)}m
      </span>
    </span>
  );
}

/**
 * The band, drawn to scale.
 *
 * The marker sits where P50 falls between P10 and P90, so a skewed forecast —
 * the common case, since jobs overrun more often than they come in early —
 * looks skewed instead of looking symmetric.
 */
function EstimateBand({ task }: { task: SiteTask }) {
  const [low, high] = task.etaRange;
  const span = Math.max(high - low, 1);
  const position = Math.min(100, Math.max(0, ((task.etaMinutes - low) / span) * 100));

  return (
    <div className="space-y-1">
      <div className="relative h-1.5 rounded-full bg-ink-700">
        <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-cat-500/25" />
        <motion.div
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cat-500 ring-2 ring-ink-900"
          animate={{ left: `${position}%` }}
          transition={{ type: "spring", stiffness: 180, damping: 26 }}
        />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-zinc-500">
        <span>{duration(low)}</span>
        <span className="uppercase tracking-wider">80% of jobs land in here</span>
        <span>{duration(high)}</span>
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: SiteTask }) {
  const style = STATE_STYLE[task.state];
  const done = task.state === "done";
  // Positive means the model expects the job to take longer than the office
  // wrote down, which is the direction that costs money.
  const versusPlanner = task.totalMinutes - task.plannerMinutes;

  return (
    <motion.article
      layout
      className="panel-raised space-y-3 p-4"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-zinc-50">{task.title}</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            {task.machineId} · {task.zone} · {TASK_TYPE_LABEL[task.taskType]} · {task.soil} ground
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            style.chip,
          )}
        >
          {style.label}
        </span>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <span className="label-xs">Progress</span>
          <span className="font-mono text-xs tabular-nums text-zinc-300">
            {Math.round(task.progress)}%
          </span>
        </div>
        <Progress
          value={task.progress}
          className="mt-1.5 h-2"
          barClassName={style.bar}
          label={`${task.title} progress`}
        />
      </div>

      {!done ? (
        <>
          <div className="flex items-end justify-between gap-3 border-t border-white/8 pt-3">
            <div>
              <div className="label-xs">Time remaining</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <Clock className="size-4 text-cat-500" aria-hidden />
                <span className="font-mono text-2xl font-bold tabular-nums text-zinc-50">
                  {duration(task.etaMinutes)}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="label-xs">Planner said</div>
              <div className="mt-0.5 font-mono text-sm tabular-nums text-zinc-500 line-through">
                {duration(task.plannerMinutes)}
              </div>
              <div
                className={cn(
                  "font-mono text-[11px] font-bold tabular-nums",
                  versusPlanner > 0 ? "text-status-warn" : "text-status-ok",
                )}
              >
                {versusPlanner > 0 ? "+" : "−"}
                {duration(Math.abs(versusPlanner))}
              </div>
            </div>
          </div>

          <EstimateBand task={task} />

          {task.drivers.length ? (
            <div className="space-y-1.5 border-t border-white/8 pt-3">
              <div className="label-xs">Why this number</div>
              <div className="flex flex-wrap gap-1.5">
                {task.drivers.map((d) => (
                  <DriverChip key={d.feature} driver={d} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <p className="border-t border-white/8 pt-3 text-xs text-muted">
          Finished. Started {task.startsAt}.
        </p>
      )}
    </motion.article>
  );
}

export function TaskBoard({ tasks }: { tasks: SiteTask[] }) {
  const open = tasks.filter((t) => t.state !== "done");
  const active = tasks.filter((t) => t.state === "active");

  const remaining = open.reduce((sum, t) => sum + t.etaMinutes, 0);
  const worstCase = open.reduce((sum, t) => sum + t.etaRange[1], 0);
  const plannerTotal = open.reduce((sum, t) => sum + t.plannerMinutes, 0);
  const modelTotal = open.reduce((sum, t) => sum + t.totalMinutes, 0);

  return (
    <div className="space-y-5">
      <section className="panel-raised p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Shift outlook</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              {active.length} job{active.length === 1 ? "" : "s"} running, {open.length} open.
              Re-estimated continuously against live conditions.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded border border-white/10 bg-ink-850 px-3 py-1.5">
            <Gauge className="size-4 text-cat-500" aria-hidden />
            <div className="text-[11px] leading-tight">
              <div className="font-semibold text-zinc-200">
                {taskTimeMetrics.ridgeMapePct}% typical error
              </div>
              <div className="text-zinc-500">
                against {taskTimeMetrics.plannerMapePct}% for the planner
              </div>
            </div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Work remaining", value: duration(remaining), hint: "P50 across open jobs" },
            { label: "Worst case", value: duration(worstCase), hint: "If every job hits its P90" },
            { label: "Model total", value: duration(modelTotal), hint: "Whole jobs, not remainder" },
            {
              label: "Planner total",
              value: duration(plannerTotal),
              hint:
                modelTotal > plannerTotal
                  ? `${duration(modelTotal - plannerTotal)} light`
                  : "Above the model",
            },
          ].map((tile) => (
            <div key={tile.label} className="rounded border border-white/8 bg-ink-850 p-3">
              <dt className="label-xs">{tile.label}</dt>
              <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-zinc-50">
                {tile.value}
              </dd>
              <p className="mt-0.5 text-[10px] text-zinc-500">{tile.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {[...tasks]
          .sort((a, b) => {
            const rank = { active: 0, queued: 1, done: 2 };
            return rank[a.state] - rank[b.state] || a.startsAt.localeCompare(b.startsAt);
          })
          .map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
      </div>
    </div>
  );
}
