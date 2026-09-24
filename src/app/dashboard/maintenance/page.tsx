"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Circle, Wrench } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { Button, Progress } from "@/components/ui/primitives";
import { ConfirmDialog, Tabs, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { maintenanceFrequencySeries, maintenanceTasks, machines } from "@/lib/mock-data";
import { CHART_COLORS, MultiBarChart } from "@/components/charts/charts";
import { cn } from "@/lib/utils";
import { MaintenanceTimeline } from "@/components/dashboard/maintenance-timeline";

type Bucket = "upcoming" | "overdue" | "completed";

export default function MaintenancePage() {
  const [tab, setTab] = React.useState<Bucket>("upcoming");
  const [items, setItems] = React.useState(maintenanceTasks);

  const toggleItem = (taskId: string, label: string) =>
    setItems((list) =>
      list.map((t) =>
        t.id === taskId
          ? { ...t, items: t.items.map((i) => (i.label === label ? { ...i, done: !i.done } : i)) }
          : t,
      ),
    );

  const filtered = items.filter((t) => t.status === tab);
  const counts = {
    upcoming: items.filter((t) => t.status === "upcoming").length,
    overdue: items.filter((t) => t.status === "overdue").length,
    completed: items.filter((t) => t.status === "completed").length,
  };

  const primary = machines[0];

  return (
    <div className="pb-10">
      <PageHeader
        title="Maintenance"
        subtitle="Service intervals, work orders and completion history across the fleet."
        actions={<RunSimulationButton size="md" />}
      />

      <div className="space-y-4 p-4">
        <section className="grid gap-4 xl:grid-cols-[1fr_1fr_1.2fr]">
          <div className="panel-raised p-4">
            <p className="label-xs">{primary.name} · next service</p>
            <p className="mt-1 font-mono text-4xl font-bold text-cat-500">
              {primary.nextServiceHours}
              <span className="ml-2 text-sm text-muted">operating hours</span>
            </p>
            <p className="mt-1 text-xs text-muted">Scheduled {primary.nextService} · technician R. Okafor</p>
            <div className="mt-4 space-y-2">
              {maintenanceTasks[0].items.map((i) => (
                <label
                  key={i.label}
                  className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={items[0].items.find((x) => x.label === i.label)?.done ?? false}
                    onChange={() => toggleItem(maintenanceTasks[0].id, i.label)}
                  />
                  {items[0].items.find((x) => x.label === i.label)?.done ? (
                    <CheckCircle2 className="size-4 text-status-ok" aria-hidden />
                  ) : (
                    <Circle className="size-4 text-muted" aria-hidden />
                  )}
                  <span className="text-zinc-200">{i.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Schedule</p>
            <div className="mt-4">
              <MaintenanceTimeline />
            </div>
          </div>

          <div className="panel-raised p-4">
            <p className="text-sm font-semibold text-zinc-100">Scheduled vs unscheduled work</p>
            <p className="text-xs text-muted">Work orders raised per month</p>
            <div className="mt-3">
              <MultiBarChart
                data={maintenanceFrequencySeries}
                xKey="month"
                height={230}
                bars={[
                  { key: "scheduled", name: "Scheduled", color: CHART_COLORS.cat },
                  { key: "unscheduled", name: "Unscheduled", color: CHART_COLORS.crit },
                ]}
              />
            </div>
          </div>
        </section>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Bucket)}>
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming ({counts.upcoming})</TabsTrigger>
            <TabsTrigger value="overdue">Overdue ({counts.overdue})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({counts.completed})</TabsTrigger>
          </TabsList>
        </Tabs>

        <ul className="grid gap-4 xl:grid-cols-2">
          {filtered.map((t) => {
            const done = t.items.filter((i) => i.done).length;
            return (
              <li
                key={t.id}
                className={cn(
                  "panel-raised border-l-4 p-4",
                  t.status === "overdue"
                    ? "border-l-status-crit"
                    : t.status === "completed"
                      ? "border-l-status-ok"
                      : "border-l-cat-500",
                )}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Wrench className="size-4 text-cat-500" aria-hidden />
                  <p className="text-sm font-semibold text-zinc-100">{t.title}</p>
                  <Link
                    href={`/dashboard/machines/${t.machineId}`}
                    className="text-xs text-muted hover:text-cat-500"
                  >
                    {t.machineName}
                  </Link>
                  <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted">
                    <CalendarClock className="size-3.5" aria-hidden />
                    {t.date}
                  </span>
                </div>

                <p className="mt-2 text-xs text-muted">
                  Technician {t.technician} ·{" "}
                  {t.status === "overdue"
                    ? `${Math.abs(t.dueInHours)} operating hours overdue`
                    : t.status === "upcoming"
                      ? `due in ${t.dueInHours} operating hours`
                      : "closed"}
                </p>

                <div className="mt-3">
                  <div className="flex items-center justify-between text-[11px] text-muted">
                    <span>Service items</span>
                    <span>
                      {done}/{t.items.length}
                    </span>
                  </div>
                  <Progress
                    value={(done / t.items.length) * 100}
                    className="mt-1.5 h-1.5"
                    barClassName={t.status === "overdue" ? "bg-status-crit" : "bg-status-ok"}
                    label={`${t.title} progress`}
                  />
                </div>

                <ul className="mt-3 space-y-1.5">
                  {t.items.map((i) => (
                    <li key={i.label}>
                      <button
                        onClick={() => toggleItem(t.id, i.label)}
                        className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-sm hover:bg-white/5"
                      >
                        {i.done ? (
                          <CheckCircle2 className="size-4 shrink-0 text-status-ok" aria-hidden />
                        ) : (
                          <Circle className="size-4 shrink-0 text-muted" aria-hidden />
                        )}
                        <span className={cn(i.done ? "text-muted line-through" : "text-zinc-200")}>{i.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>

                {t.status !== "completed" ? (
                  <div className="mt-3">
                    <ConfirmDialog
                      trigger={
                        <Button variant="outline" size="sm">
                          Mark work order complete
                        </Button>
                      }
                      title={`Close ${t.title}?`}
                      description="This records the work order as complete and resets the machine's service interval."
                      confirmLabel="Mark complete"
                      onConfirm={() => {
                        setItems((list) =>
                          list.map((x) =>
                            x.id === t.id
                              ? { ...x, status: "completed", items: x.items.map((i) => ({ ...i, done: true })) }
                              : x,
                          ),
                        );
                        toast.success(`${t.title} closed for ${t.machineName}`);
                      }}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
