"use client";

import { maintenanceTimeline } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

/** Vertical service timeline shared by the maintenance page. */
export function MaintenanceTimeline() {
  const ordered = [...maintenanceTimeline].sort((a, b) => (a.state === "overdue" ? -1 : b.state === "overdue" ? 1 : 0));
  return (
    <ol className="relative space-y-4 border-l border-white/12 pl-6">
      {ordered.map((t) => (
        <li key={t.date + t.title} className="relative">
          <span
            className={cn(
              "absolute -left-[31px] top-1 size-3.5 rounded-full border-2 border-ink-900",
              t.state === "overdue" ? "bg-status-crit" : t.state === "completed" ? "bg-status-ok" : "bg-cat-500",
            )}
          />
          <p className="text-sm font-semibold text-zinc-100">{t.title}</p>
          <p className="text-xs text-muted">
            {t.machine} · {t.date}
          </p>
          <span
            className={cn(
              "mt-1 inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
              t.state === "overdue"
                ? "bg-status-crit/15 text-status-crit"
                : t.state === "completed"
                  ? "bg-status-ok/15 text-status-ok"
                  : "bg-cat-500/15 text-cat-500",
            )}
          >
            {t.state}
          </span>
        </li>
      ))}
    </ol>
  );
}
