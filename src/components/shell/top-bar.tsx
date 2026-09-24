"use client";

/**
 * Top bar: where you are, what the site is doing right now, and what needs
 * attention. It is the only element on screen that is identical everywhere,
 * which is what makes moving between surfaces feel like one product.
 */
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  CloudRain,
  CloudSun,
  Search,
  Sun,
  Waves,
  type LucideIcon,
} from "lucide-react";
import { activeNavItem } from "./nav-config";
import { NavToggle } from "./app-shell";
import { useAlerts, useSnapshot } from "@/lib/hooks/use-site";
import { SITE_NAME } from "@/lib/api/seed";
import { Button } from "@/components/ui/primitives";
import { SeverityChip } from "@/components/ui/status";
import { EmptyPanel } from "@/components/ui/states";
import { relativeTime } from "@/components/alerts/alert-card";
import { thresholdStatus } from "@/lib/status";
import { MACHINE_STATUS } from "@/lib/status";
import type { WeatherMode } from "@/lib/api/contracts";
import { cn } from "@/lib/utils";

const WEATHER: Record<WeatherMode, { icon: LucideIcon; label: string }> = {
  clear: { icon: Sun, label: "Clear" },
  rain: { icon: CloudRain, label: "Rain" },
  fog: { icon: Waves, label: "Fog" },
  heat: { icon: CloudSun, label: "Heat" },
};

function AlertBell() {
  const { data: alerts, acknowledgeAll } = useAlerts();
  const [open, setOpen] = React.useState(false);
  const unread = alerts.filter((a) => !a.acknowledged);
  const worst = unread.some((a) => a.severity === "critical")
    ? "critical"
    : unread.length
      ? "warning"
      : null;

  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Alerts, ${unread.length} needing acknowledgement`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="size-4.5" aria-hidden />
        {unread.length ? (
          <span
            className={cn(
              "absolute right-1 top-1 grid min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold ring-2 ring-ink-900",
              worst === "critical"
                ? "bg-status-crit text-white"
                : "bg-status-warn text-ink-950",
            )}
          >
            {unread.length}
          </span>
        ) : null}
      </Button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="panel-raised absolute right-0 top-12 z-50 w-96 overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="label-xs">Active alerts</span>
              {unread.length ? (
                <button
                  className="text-[11px] font-semibold text-cat-500 hover:underline"
                  onClick={acknowledgeAll}
                >
                  Acknowledge all
                </button>
              ) : null}
            </div>
            {alerts.length ? (
              <ul className="max-h-96 overflow-y-auto">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className="border-b border-white/5 px-3 py-2.5 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <SeverityChip severity={a.severity} size="sm" />
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-100">
                        {a.title}
                      </p>
                      <span className="shrink-0 font-mono text-[10px] text-muted">
                        {relativeTime(a.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">
                      {a.message}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyPanel
                tone="good"
                title="No active alerts"
                body="Every machine on site is inside its safety and health limits."
              />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function TopBar({
  onOpenNav,
  onOpenPalette,
}: {
  onOpenNav: () => void;
  onOpenPalette: () => void;
}) {
  const pathname = usePathname();
  const snapshot = useSnapshot();
  const current = activeNavItem(pathname);
  const weather = WEATHER[snapshot?.weather ?? "clear"];
  const WeatherIcon = weather.icon;
  const riskStatus = snapshot
    ? thresholdStatus(snapshot.riskScore, { warn: 40, crit: 65 })
    : "operating";

  return (
    <header className="relative z-20 flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-ink-900/60 px-3 backdrop-blur-xl sm:px-5">
      <NavToggle onClick={onOpenNav} />

      <div className="min-w-0">
        <h1 className="truncate text-base font-bold tracking-tight text-zinc-50">
          {current?.label ?? "CAT Copilot"}
        </h1>
        <p className="truncate text-[11px] text-muted">
          {SITE_NAME}
          {snapshot ? ` · ${snapshot.shift}` : ""}
        </p>
      </div>

      {current?.internal ? (
        <span className="hazard-stripe shrink-0 rounded px-0.5 py-0.5">
          <span className="block rounded bg-ink-950 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-cat-500">
            Demo control
          </span>
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        {/* Live site conditions — the reason a task got re-ordered. */}
        {snapshot ? (
          <div className="hidden items-center divide-x divide-white/10 rounded-full border border-white/[0.08] bg-white/[0.03] px-1 text-[11px] xl:flex">
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-zinc-300">
              <WeatherIcon className="size-3.5 text-cat-500" aria-hidden />
              {weather.label} · {snapshot.temperatureC}&deg;C
            </span>
            <span className="flex items-center gap-1.5 px-2.5 py-1.5">
              <span className="text-muted">Site risk</span>
              <span
                className={cn(
                  "font-mono font-bold tabular-nums",
                  MACHINE_STATUS[riskStatus].text,
                )}
              >
                {snapshot.riskScore}
              </span>
            </span>
            <span className="px-2.5 py-1.5 font-mono tabular-nums text-zinc-300">
              {snapshot.clock}
            </span>
          </div>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenPalette}
          className="hidden gap-2 text-muted sm:inline-flex"
          aria-label="Search and jump to a screen"
        >
          <Search className="size-3.5" aria-hidden />
          <span className="hidden md:inline">Jump to</span>
          <kbd className="hidden rounded border border-white/15 bg-white/5 px-1 font-mono text-[10px] md:inline">
            Ctrl K
          </kbd>
        </Button>

        <AlertBell />

        <Link
          href="/cab"
          className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] py-1 pl-1 pr-3 transition-colors hover:border-cat-500/40"
        >
          <span className="bg-gradient-cat grid size-8 shrink-0 place-items-center rounded-full text-[10px] font-bold text-ink-950">
            RS
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-[11px] font-semibold leading-tight text-zinc-200">
              R. Subramanian
            </span>
            <span className="block truncate text-[10px] leading-tight text-muted">
              OP-1042 · EXC001
            </span>
          </span>
        </Link>
      </div>
    </header>
  );
}
