"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BellRing,
  ClipboardList,
  Cog,
  FileBarChart,
  FileWarning,
  Gauge,
  LayoutGrid,
  Radio,
  ScanLine,
  Stethoscope,
  Truck,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/shared/status";
import { useMachineHealth, useMachineStore } from "@/store/machine-store";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutGrid },
  { href: "/dashboard/fleet", label: "Fleet", icon: Truck },
  { href: "/dashboard/machines", label: "Machines", icon: Gauge },
  { href: "/dashboard/live", label: "Live Monitoring", icon: Activity },
  { href: "/dashboard/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/dashboard/diagnostics", label: "Diagnostics", icon: Stethoscope },
  { href: "/dashboard/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/dashboard/alerts", label: "Alerts", icon: BellRing },
  { href: "/dashboard/incidents", label: "Incidents", icon: FileWarning },
  { href: "/dashboard/usage", label: "Unusual usage", icon: ScanLine },
  { href: "/dashboard/reports", label: "Reports", icon: FileBarChart },
  { href: "/dashboard/settings", label: "Settings", icon: Cog },
];

export function Sidebar() {
  const pathname = usePathname();
  const health = useMachineHealth();
  const openAlerts = useMachineStore((s) => s.alerts.filter((a) => !a.acknowledged).length);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-white/10 bg-ink-900">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <div className="flex size-10 items-center justify-center rounded bg-cat-500 font-black text-ink-950">CV</div>
        <div>
          <p className="text-sm font-bold tracking-wide text-zinc-100">CAT Visual Assist</p>
          <p className="text-[11px] uppercase tracking-[0.14em] text-muted">Fleet control</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Dashboard sections">
        <ul className="space-y-0.5">
          {nav.map((item) => {
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-cat-500/12 text-cat-500 shadow-[inset_2px_0_0_0_var(--color-cat-500)]"
                      : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
                  )}
                >
                  <Icon className="size-4.5 shrink-0" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  {item.label === "Alerts" && openAlerts > 0 ? (
                    <span className="rounded-full bg-status-crit px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {openAlerts}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-2 border-t border-white/10 px-3 py-3 text-xs">
        <div className="flex items-center justify-between">
          <span className="label-xs">System</span>
          <span className="inline-flex items-center gap-2 text-zinc-300">
            <StatusDot status={health} pulse />
            {health === "healthy" ? "Nominal" : health === "warning" ? "Degraded" : "Attention"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="label-xs">Link</span>
          <span className="inline-flex items-center gap-2 text-zinc-300">
            <Radio className="size-3.5 text-status-ok" aria-hidden />
            LTE · 24 online
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3 rounded border border-white/10 bg-ink-850 px-3 py-2.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-ink-700 text-[11px] font-bold text-cat-500">
            JD
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-zinc-200">J. Delgado</p>
            <p className="truncate text-[11px] text-muted">Site supervisor</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
