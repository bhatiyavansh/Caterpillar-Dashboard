"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NAV, activeNavItem, type NavItem } from "./nav-config";
import { useAlerts, useConnection, useFleet } from "@/lib/hooks/use-site";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useOpenBreakdowns } from "@/components/maintenance/fault-indicators";

const CONNECTION_COPY = {
  connecting: { label: "Connecting", dot: "bg-status-warn", help: "Waiting for the first site frame." },
  live: { label: "Live stream", dot: "bg-status-ok", help: "Connected to the site WebSocket hub." },
  simulated: { label: "Simulated site", dot: "bg-status-info", help: "Running on the built-in site simulation." },
  error: { label: "Stream error", dot: "bg-status-crit", help: "The hub dropped. Showing the last known state." },
} as const;

function isActive(pathname: string, href: string): boolean {
  return activeNavItem(pathname)?.href === href;
}

function NavLink({
  item,
  collapsed,
  badge,
}: {
  item: NavItem;
  collapsed: boolean;
  badge?: number;
}) {
  const pathname = usePathname();
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-2 py-1.5 transition-all",
        active
          ? "bg-gradient-to-r from-cat-500/18 to-cat-500/[0.03] text-cat-400 ring-1 ring-cat-500/25"
          : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100",
        collapsed && "justify-center px-0",
      )}
    >
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
          active
            ? "bg-gradient-cat text-ink-950 shadow-[0_4px_14px_-4px_rgb(255_205_17/0.6)]"
            : "bg-white/[0.04] text-zinc-400 group-hover:bg-white/[0.08] group-hover:text-zinc-100",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      {!collapsed ? (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-tight">{item.label}</span>
          <span
            className={cn(
              "block truncate text-[11px] leading-tight",
              active ? "text-cat-500/70" : "text-zinc-500",
            )}
          >
            {item.audience}
          </span>
        </span>
      ) : null}
      {badge ? (
        <span
          className={cn(
            "rounded-full bg-status-crit px-1.5 py-0.5 text-[10px] font-bold text-white",
            collapsed && "absolute right-1 top-1 px-1 py-0",
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );

  return collapsed ? <Hint label={`${item.label} — ${item.audience}`}>{link}</Hint> : link;
}

export function AppSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle?: () => void;
}) {
  const connection = useConnection();
  const { data: alerts } = useAlerts({ includeAcknowledged: false });
  const breakdowns = useOpenBreakdowns();
  const { kpis } = useFleet();
  const conn = CONNECTION_COPY[connection];

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-white/[0.07] bg-ink-900/70 backdrop-blur-xl transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-64",
      )}
      aria-label="Primary"
    >
      {/* Brand */}
      <div className={cn("flex items-center gap-3 border-b border-white/[0.07] px-4 py-4", collapsed && "justify-center px-0")}>
        <span className="bg-gradient-cat grid size-10 shrink-0 place-items-center rounded-xl text-sm font-black text-ink-950 shadow-[0_6px_20px_-6px_rgb(255_205_17/0.7)]">CAT</span>
        {!collapsed ? (
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold tracking-tight text-zinc-50">
              CAT <span className="text-gradient-cat">Copilot</span>
            </span>
            <span className="block truncate text-[10px] uppercase tracking-[0.16em] text-muted">
              Site intelligence
            </span>
          </span>
        ) : null}
      </div>

      <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-3">
        {NAV.map((group, i) => (
          <div key={group.id} className={cn("mb-4 last:mb-0", group.id === "internal" && "mt-auto")}>
            {!collapsed ? (
              <p className="label-xs px-2.5 pb-1.5">{group.label}</p>
            ) : i > 0 ? (
              <div className="mx-2 mb-2 border-t border-white/8" aria-hidden />
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink
                    item={item}
                    collapsed={collapsed}
                    badge={item.href === "/command" ? alerts.length : item.href === "/ar" ? breakdowns : undefined}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* System status */}
      <div className="space-y-2 border-t border-white/10 px-2 py-3">
        <Hint label={conn.help}>
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2",
              collapsed && "justify-center px-0",
            )}
          >
            <span className={cn("relative size-2 shrink-0 rounded-full pulse-ring", conn.dot)} aria-hidden />
            {!collapsed ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-semibold text-zinc-200">{conn.label}</span>
                <span className="block truncate text-[10px] text-muted">
                  {kpis ? `${kpis.active}/${kpis.fleetSize} machines reporting` : "Waiting for telemetry"}
                </span>
              </span>
            ) : (
              <span className="sr-only">{conn.label}</span>
            )}
          </div>
        </Hint>

        {onToggle ? (
          <button
            onClick={onToggle}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="flex w-full items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] font-semibold text-muted transition-colors hover:bg-white/5 hover:text-zinc-200"
          >
            {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
            {!collapsed ? "Collapse" : null}
          </button>
        ) : null}
      </div>
    </aside>
  );
}
