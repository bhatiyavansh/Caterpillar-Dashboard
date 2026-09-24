"use client";

import {
  PageHeader,
  RunSimulationButton,
} from "@/components/navigation/dashboard-shell";
import { TaskBoard } from "@/components/tasks/task-board";
import { useSnapshot, useTasks } from "@/lib/hooks/use-site";

const WEATHER_LABEL: Record<string, string> = {
  clear: "clear",
  rain: "rain",
  fog: "fog",
  heat: "extreme heat",
};

export default function TasksPage() {
  const { data: tasks } = useTasks();
  const snapshot = useSnapshot();

  return (
    <div className="pb-10">
      <PageHeader
        title="Today's tasks"
        subtitle={
          `Scheduled work for the shift, estimated against ${WEATHER_LABEL[snapshot.weather] ?? snapshot.weather} ` +
          `at ${snapshot.temperatureC}°C. Every estimate updates as conditions do.`
        }
        actions={<RunSimulationButton size="md" />}
      />

      <div className="space-y-4 p-4">
        <div className="panel-raised p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-zinc-100">
              Shift progress
            </p>
            <span className="font-mono text-sm text-zinc-300">
              {completed}/{tasks.length}
            </span>
          </div>
          <Progress
            value={(completed / tasks.length) * 100}
            className="mt-3 h-2.5"
            barClassName="bg-status-ok"
            label="Shift task progress"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {columns.map((col) => {
            const items = tasks.filter((t) => t.status === col.key);
            return (
              <section
                key={col.key}
                className={cn("panel-raised border-t-4 p-4", col.accent)}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-200">
                    {col.label}
                  </h2>
                  <span className="rounded bg-white/8 px-2 py-0.5 font-mono text-xs text-zinc-300">
                    {items.length}
                  </span>
                </div>

                {items.length === 0 ? (
                  <div className="mt-3">
                    <EmptyState
                      icon={<ClipboardList className="size-7" />}
                      title="Nothing here"
                      body={`No tasks are currently ${col.label.toLowerCase()}.`}
                    />
                  </div>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {items.map((t) => (
                      <li key={t.id}>
                        <button
                          onClick={() => {
                            cycle(t.id);
                            toast.success(`${t.title} moved on`);
                          }}
                          className="w-full rounded border border-white/10 bg-ink-850 p-3 text-left transition-colors hover:border-white/25"
                        >
                          <div className="flex items-start gap-2.5">
                            {t.status === "completed" ? (
                              <CheckCircle2
                                className="mt-0.5 size-4 shrink-0 text-status-ok"
                                aria-hidden
                              />
                            ) : t.status === "in-progress" ? (
                              <CircleDashed
                                className="mt-0.5 size-4 shrink-0 text-cat-500"
                                aria-hidden
                              />
                            ) : (
                              <Circle
                                className="mt-0.5 size-4 shrink-0 text-muted"
                                aria-hidden
                              />
                            )}
                            <div className="min-w-0">
                              <p
                                className={cn(
                                  "text-sm font-semibold",
                                  t.status === "completed"
                                    ? "text-muted line-through"
                                    : "text-zinc-100",
                                )}
                              >
                                {t.title}
                              </p>
                              <p className="mt-0.5 text-xs text-muted">
                                {t.description}
                              </p>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                            <span
                              className={cn(
                                "rounded px-2 py-0.5 font-bold uppercase tracking-wider",
                                priorityStyle[t.priority],
                              )}
                            >
                              {t.priority}
                            </span>
                            <span className="text-muted">{t.assignee}</span>
                            <span className="ml-auto text-muted">{t.due}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>

        <p className="text-xs text-muted">
          Selecting a task advances it to the next state — pending, in progress,
          then completed.
        </p>
      </div>
    </div>
  );
}
