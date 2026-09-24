"use client";

/**
 * Small, persistent pointers to an open breakdown: a pill in the top bar and a
 * count on the AR maintenance item in the sidebar. They stay until the work
 * order closes, so a dismissed toast never means a forgotten machine.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wrench } from "lucide-react";
import { MACHINE, phaseAtLeast, type Phase } from "@/lib/maintenance/hydraulic-leak";
import { useFaultView } from "@/lib/maintenance/fault-store";
import { breakdownHref, inMaintenance } from "./fault-watcher";
import { cn } from "@/lib/utils";

const PILL_COPY: Partial<Record<Phase, string>> = {
  degrading: "hydraulic health trending down",
  detected: "hydraulic leak",
  safed: "hydraulic leak · awaiting technician",
  dispatched: "technician en route",
  repairing: "repair in progress",
  verifying: "test cycle running",
  verified: "repair verified · close work order",
};

export function FaultPill() {
  const view = useFaultView();
  const pathname = usePathname();
  if (!view || inMaintenance(pathname)) return null;
  const copy = PILL_COPY[view.phase];
  if (!copy) return null;
  const critical = phaseAtLeast(view.phase, "detected") && !phaseAtLeast(view.phase, "verified");

  return (
    <Link
      href={breakdownHref(MACHINE.id)}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors",
        critical
          ? "border-status-crit/50 bg-status-crit/12 text-status-crit hover:bg-status-crit/20"
          : view.phase === "verified"
            ? "border-status-ok/50 bg-status-ok/10 text-status-ok hover:bg-status-ok/20"
            : "border-status-warn/50 bg-status-warn/10 text-status-warn hover:bg-status-warn/20",
      )}
    >
      <span className="relative flex size-2">
        {critical ? <span className="absolute inset-0 animate-ping rounded-full bg-status-crit opacity-70" /> : null}
        <span className={cn("relative size-2 rounded-full", critical ? "bg-status-crit" : "bg-current")} />
      </span>
      <Wrench className="size-3.5" aria-hidden />
      <span className="hidden md:inline">
        {MACHINE.id}: {copy}
      </span>
      <span className="md:hidden">{MACHINE.id}</span>
    </Link>
  );
}

/** Open breakdowns, for the sidebar badge. */
export function useOpenBreakdowns(): number {
  const view = useFaultView();
  return view && phaseAtLeast(view.phase, "detected") && view.phase !== "closed" ? 1 : 0;
}
