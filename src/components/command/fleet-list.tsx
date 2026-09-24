"use client";

/**
 * The left rail of the command centre: every machine, sorted so the ones that
 * need a human are always at the top.
 */
import * as React from "react";
import { Filter } from "lucide-react";
import type { Machine, MachineStatus } from "@/lib/api/contracts";
import { MACHINE_STATUS } from "@/lib/status";
import { SectionHeader } from "@/components/ui/data";
import { StatusLabel } from "@/components/ui/status";
import { EmptyPanel, SkeletonRows } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { XrayLink } from "@/components/shared/xray-link";

/** Attention first, then hardest-working, then the rest. */
const ORDER: Record<MachineStatus, number> = {
  critical: 0,
  warning: 1,
  operating: 2,
  idle: 3,
  maintenance: 4,
  offline: 5,
};

type FilterKey = "all" | "attention" | "active";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "attention", label: "Attention" },
  { key: "active", label: "Active" },
];

export function FleetList({
  machines,
  selectedId,
  onSelect,
  loading,
  className,
}: {
  machines: Machine[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  className?: string;
}) {
  const [filter, setFilter] = React.useState<FilterKey>("all");

  const rows = React.useMemo(() => {
    const filtered = machines.filter((m) => {
      if (filter === "attention") return m.status === "critical" || m.status === "warning";
      if (filter === "active") return m.status === "operating" || m.status === "warning" || m.status === "critical";
      return true;
    });
    return [...filtered].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id));
  }, [machines, filter]);

  const attention = machines.filter((m) => m.status === "critical" || m.status === "warning").length;

  return (
    <section className={cn("flex min-h-0 flex-col border-r border-white/10 bg-ink-900", className)}>
      <SectionHeader
        title="Fleet"
        meta={attention ? `${attention} need attention` : "All nominal"}
        actions={
          <div className="flex items-center gap-0.5" role="group" aria-label="Filter the fleet list">
            <Filter className="mr-1 size-3 text-muted" aria-hidden />
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                  filter === f.key ? "bg-cat-500 text-ink-950" : "text-muted hover:text-zinc-200",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <SkeletonRows rows={6} />
        ) : rows.length ? (
          <ul>
            {rows.map((m) => {
              const token = MACHINE_STATUS[m.status];
              const selected = m.id === selectedId;
              const attentionRow = m.status === "critical" || m.status === "warning";
              return (
                <li key={m.id} className="flex items-stretch border-b border-white/5">
                  <button
                    onClick={() => onSelect(m.id)}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "relative flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left transition-colors",
                      selected ? "bg-cat-500/10" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <span
                      className={cn("absolute inset-y-0 left-0 w-0.5", attentionRow ? token.dot : "bg-transparent")}
                      aria-hidden
                    />

                    <span
                      className={cn(
                        "grid size-9 shrink-0 place-items-center rounded border font-mono text-[10px] font-bold",
                        token.border,
                        token.bg,
                        token.text,
                      )}
                      aria-hidden
                    >
                      {m.kind.slice(0, 2).toUpperCase()}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-bold text-zinc-50">{m.id}</span>
                        <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">
                          {m.status === "offline" ? "—" : `${Math.round(m.utilization)}%`}
                        </span>
                      </span>
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[11px] text-muted">{m.kindLabel}</span>
                        <StatusLabel status={m.status} pulse={m.status === "critical"} soundKey={m.id} />
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-400">
                        {m.taskLabel ?? (m.status === "offline" ? "No telemetry" : "No task assigned")}
                      </span>
                    </span>
                  </button>
                  {attentionRow ? (
                    <span className={cn("flex items-center pr-2", selected && "bg-cat-500/10")}>
                      <XrayLink machineId={m.id} issue={{ text: m.taskLabel ?? null }} compact />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyPanel
            tone="good"
            title="Nothing matches this filter"
            body={
              filter === "attention"
                ? "No machine currently has an unresolved warning or critical alert."
                : "No machine is active under this filter right now."
            }
          />
        )}
      </div>
    </section>
  );
}
