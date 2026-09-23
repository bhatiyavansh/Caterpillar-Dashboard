"use client";

import * as React from "react";
import { BadgeCheck, Clock, ShieldCheck, User } from "lucide-react";
import { operator } from "@/lib/mock-data";
import { Progress } from "@/components/ui/primitives";
import { useMachineStore } from "@/store/machine-store";
import { ScreenPad, SectionTitle, TouchButton } from "../touch";
import type { MachineScreen } from "../machine-app";

export function OperatorScreen({ navigate }: { navigate: (s: MachineScreen) => void }) {
  // Select the stored array, then narrow it in render. Filtering inside the
  // selector returns a new array on every store read, which makes the snapshot
  // compare unequal forever and drives React into an update loop.
  const allTasks = useMachineStore((s) => s.tasks);
  const tasks = React.useMemo(
    () => allTasks.filter((t) => t.machineId === operator.machineId),
    [allTasks],
  );
  const completed = tasks.filter((t) => t.status === "completed").length;

  return (
    <ScreenPad className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
      <section className="rounded border border-white/10 bg-ink-900 p-6">
        <div className="flex items-center gap-4">
          <div className="flex size-20 items-center justify-center rounded-full bg-cat-500 text-3xl font-black text-ink-950">
            A
          </div>
          <div>
            <p className="text-3xl font-bold text-zinc-50">{operator.name.split(" ")[0]}</p>
            <p className="text-sm text-muted">
              {operator.name} · {operator.id}
            </p>
          </div>
        </div>

        <dl className="mt-6 space-y-4">
          {[
            { icon: Clock, k: "Shift", v: operator.shift },
            { icon: User, k: "Machine", v: "CAT 320 · CAT-320-014" },
            { icon: Clock, k: "Today's operating time", v: operator.operatingTimeToday },
          ].map(({ icon: Icon, k, v }) => (
            <div key={k} className="flex items-center gap-3 rounded border border-white/10 bg-ink-850 px-4 py-3">
              <Icon className="size-5 text-cat-500" aria-hidden />
              <div>
                <dt className="label-xs">{k}</dt>
                <dd className="text-lg font-semibold text-zinc-100">{v}</dd>
              </div>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex items-center gap-3 rounded border-2 border-status-ok/40 bg-status-ok/8 px-4 py-4">
          <ShieldCheck className="size-8 text-status-ok" aria-hidden />
          <div>
            <p className="label-xs">Safety status</p>
            <p className="text-xl font-black uppercase tracking-[0.12em] text-status-ok">Good</p>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="rounded border border-white/10 bg-ink-900 p-5">
          <SectionTitle right={<span className="text-sm text-muted">{operator.tasksCompleted} / {operator.tasksTotal}</span>}>
            Tasks completed today
          </SectionTitle>
          <Progress
            value={(operator.tasksCompleted / operator.tasksTotal) * 100}
            className="h-3"
            barClassName="bg-status-ok"
            label="Tasks completed today"
          />
          <p className="mt-3 text-sm text-muted">
            {completed} of {tasks.length} assigned checks on this machine are closed out.
          </p>
          <ul className="mt-4 space-y-2">
            {tasks.map((t) => (
              <li key={t.id} className="flex min-h-14 items-center gap-3 rounded bg-white/4 px-4">
                <span
                  className={
                    t.status === "completed"
                      ? "size-2.5 rounded-full bg-status-ok"
                      : t.status === "in-progress"
                        ? "size-2.5 rounded-full bg-cat-500"
                        : "size-2.5 rounded-full bg-zinc-600"
                  }
                />
                <span className="text-base font-semibold text-zinc-100">{t.title}</span>
                <span className="ml-auto text-xs uppercase tracking-widest text-muted">{t.status.replace("-", " ")}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded border border-white/10 bg-ink-900 p-5">
          <SectionTitle>Certifications</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {operator.certifications.map((c) => (
              <span
                key={c}
                className="inline-flex items-center gap-2 rounded border border-white/12 bg-ink-850 px-3 py-2 text-sm text-zinc-200"
              >
                <BadgeCheck className="size-4 text-status-ok" aria-hidden />
                {c}
              </span>
            ))}
          </div>
        </div>

        <TouchButton tone="primary" full onClick={() => navigate("inspection")}>
          Continue daily inspection
        </TouchButton>
      </section>
    </ScreenPad>
  );
}
