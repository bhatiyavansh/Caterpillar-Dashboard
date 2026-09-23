"use client";

import * as React from "react";
import { LayoutGrid, Search, Table2 } from "lucide-react";
import { PageHeader, RunSimulationButton } from "@/components/navigation/dashboard-shell";
import { MachineCard, MachineTable } from "@/components/dashboard/machine-card";
import { Button, EmptyState, Input, Select } from "@/components/ui/primitives";
import { machines } from "@/lib/mock-data";
import type { HealthStatus } from "@/lib/types";
import { useMachineHealth } from "@/store/machine-store";

export default function FleetPage() {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | HealthStatus>("all");
  const [view, setView] = React.useState<"grid" | "table">("grid");
  const liveHealth = useMachineHealth();

  // CAT 320 mirrors the live simulated machine rather than its seed value.
  const list = machines.map((m) => (m.id === "CAT-320-014" ? { ...m, health: liveHealth } : m));

  const filtered = list.filter((m) => {
    const matchesQuery =
      query.trim() === "" ||
      [m.name, m.id, m.type, m.location, m.operator].join(" ").toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "all" || m.health === filter;
    return matchesQuery && matchesFilter;
  });

  return (
    <div className="pb-10">
      <PageHeader
        title="Fleet"
        subtitle="Every connected machine on Northgate Quarry, with live operating figures."
        actions={<RunSimulationButton size="md" />}
      />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by machine, type, operator or location"
              className="pl-9"
              aria-label="Search fleet"
            />
          </div>
          <Select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            aria-label="Filter by health"
          >
            <option value="all">All health states</option>
            <option value="healthy">Healthy</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </Select>
          <div className="flex gap-1 rounded border border-white/10 bg-ink-900 p-1">
            <Button
              variant={view === "grid" ? "primary" : "ghost"}
              size="sm"
              onClick={() => setView("grid")}
              aria-pressed={view === "grid"}
            >
              <LayoutGrid className="size-4" aria-hidden /> Cards
            </Button>
            <Button
              variant={view === "table" ? "primary" : "ghost"}
              size="sm"
              onClick={() => setView("table")}
              aria-pressed={view === "table"}
            >
              <Table2 className="size-4" aria-hidden /> Table
            </Button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No machines match those filters"
            body="Try clearing the search box or selecting a different health state."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : view === "grid" ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filtered.map((m) => (
              <MachineCard key={m.id} machine={m} />
            ))}
          </div>
        ) : (
          <MachineTable machines={filtered} />
        )}
      </div>
    </div>
  );
}
