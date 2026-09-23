"use client";

import * as React from "react";
import { Bell, Menu, MonitorPlay, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Sidebar } from "./sidebar";
import { Button, Input } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/tooltip";
import { useMachineStore } from "@/store/machine-store";
import { cn } from "@/lib/utils";

export function RunSimulationButton({ className, size = "lg" }: { className?: string; size?: "md" | "lg" | "touch" }) {
  const open = useMachineStore((s) => s.openSimulation);
  return (
    <Button
      variant="primary"
      size={size}
      onClick={open}
      className={cn("uppercase tracking-[0.08em]", className)}
      data-testid="run-simulation"
    >
      <MonitorPlay className="size-5" aria-hidden />
      Run Simulation
    </Button>
  );
}

function NotificationBell() {
  const notifications = useMachineStore((s) => s.notifications);
  const markRead = useMachineStore((s) => s.markNotificationsRead);
  const [open, setOpen] = React.useState(false);
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="relative">
      <Hint label="Notifications">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications, ${unread} unread`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Bell className="size-4.5" aria-hidden />
          {unread > 0 ? (
            <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-status-crit ring-2 ring-ink-900" />
          ) : null}
        </Button>
      </Hint>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="panel-raised absolute right-0 top-12 z-50 w-80 p-2"
          >
            <div className="flex items-center justify-between px-2 py-1">
              <span className="label-xs">Notifications</span>
              <button className="text-[11px] text-cat-500 hover:underline" onClick={markRead}>
                Mark all read
              </button>
            </div>
            <ul className="max-h-80 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id} className="rounded px-2 py-2 hover:bg-white/5">
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        n.severity === "critical" ? "bg-status-crit" : n.severity === "warning" ? "bg-status-warn" : "bg-status-info",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-zinc-200">{n.title}</p>
                      <p className="text-[11px] text-muted">{n.body}</p>
                    </div>
                    <span className="ml-auto text-[10px] text-muted">{n.time}</span>
                  </div>
                </li>
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = React.useState(false);

  return (
    <div className="flex h-dvh overflow-hidden bg-ink-950">
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      <AnimatePresence>
        {navOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/70"
              onClick={() => setNavOpen(false)}
            />
            <motion.div
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="relative h-full w-60"
            >
              <Sidebar />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                className="absolute right-2 top-3"
                onClick={() => setNavOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 bg-ink-900 px-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="size-5" />
          </Button>

          <div className="relative hidden max-w-sm flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input placeholder="Search machines, alerts, work orders…" className="pl-9" aria-label="Search" />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <RunSimulationButton size="md" className="hidden sm:inline-flex" />
            <div className="flex items-center gap-2 rounded border border-white/10 bg-ink-850 py-1.5 pl-2 pr-3">
              <div className="flex size-7 items-center justify-center rounded-full bg-ink-700 text-[11px] font-bold text-cat-500">
                JD
              </div>
              <span className="hidden text-xs font-semibold text-zinc-200 sm:block">J. Delgado</span>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-white/10 bg-ink-900/40 px-4 py-4">
      <div className="min-w-0">
        {/* The section rail above already names the area, so this states the
            page, not the product. A display-sized heading here would push the
            actual records below the fold for no gain. */}
        <h1 className="text-lg font-bold leading-tight tracking-tight text-zinc-50">{title}</h1>
        <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
