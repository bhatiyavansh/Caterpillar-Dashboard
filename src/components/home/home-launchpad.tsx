"use client";

/**
 * Home: the one place that explains the whole product.
 *
 * Before this existed `/` redirected to the command centre, so a first-time
 * visitor landed in the most information-dense screen with no map of the rest.
 * Here every surface is a card that says who it is for and what it does, and
 * the live site sits above them so the page is still useful on the tenth visit.
 */
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, Sparkles, type LucideIcon } from "lucide-react";
import { NAV } from "@/components/shell/nav-config";
import { useAlerts, useFleet, useSnapshot } from "@/lib/hooks/use-site";
import { SITE_NAME } from "@/lib/api/seed";
import { cn } from "@/lib/utils";

/** One line per surface — what you actually do there. */
const BLURB: Record<string, string> = {
  "/hmi": "The operator's in-cab screen: today's jobs, seatbelt and proximity safety, coaching and training.",
  "/command": "Live site map, every machine and every alert, with the time-scrubber to replay the shift.",
  "/cab": "The full operator cab HMI with cameras, task panel and the voice assistant.",
  "/twin": "Drive the excavator through a 3D site and watch the safety systems react.",
  "/owner": "Utilisation, idle cost, fuel and carbon across the fleet, in rupees.",
  "/training": "Skill path, incident replays, instructor booking and the browser simulator.",
  "/ar": "Step-by-step maintenance procedures, built for a phone held at the machine.",
  "/dashboard": "Machine records: fleet, diagnostics, maintenance, tasks, alerts and reports.",
  "/director": "Trigger demo scenarios such as an unbuckled seatbelt or a worker in the swing radius.",
  "/machine": "The original in-cab hardware display simulation.",
  "/dev/stream": "Inspect the raw WebSocket frames coming off the site hub.",
  "/dev/avatar": "Test bench for the voice assistant and its avatar.",
};

const GROUP_ACCENT: Record<string, string> = {
  operate: "from-cat-500/25 via-cat-500/5",
  manage: "from-status-info/25 via-status-info/5",
  records: "from-status-ok/20 via-status-ok/5",
  internal: "from-white/10 via-white/[0.02]",
};

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="glass rounded-2xl px-4 py-3">
      <p className="label-xs">{label}</p>
      <p className={cn("mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-50", tone)}>{value}</p>
    </div>
  );
}

function SurfaceCard({
  href,
  label,
  audience,
  icon: Icon,
  accent,
  featured,
  index,
}: {
  href: string;
  label: string;
  audience: string;
  icon: LucideIcon;
  accent: string;
  featured?: boolean;
  index: number;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03 * index, duration: 0.3 }}
    >
      <Link
        href={href}
        className={cn(
          "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/70 p-5 transition-all",
          "hover:-translate-y-0.5 hover:border-cat-500/40 hover:shadow-[0_20px_50px_-24px_rgb(255_205_17/0.35)]",
        )}
      >
        <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-70", accent)} aria-hidden />
        <div className="relative flex items-start justify-between gap-3">
          <span
            className={cn(
              "grid size-11 place-items-center rounded-xl border border-white/10 bg-ink-950/60 text-cat-400 transition-colors",
              "group-hover:bg-gradient-cat group-hover:text-ink-950",
            )}
          >
            <Icon className="size-5" aria-hidden />
          </span>
          {featured ? (
            <span className="bg-gradient-cat inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-950">
              <Sparkles className="size-3" aria-hidden /> New
            </span>
          ) : null}
        </div>
        <h3 className="relative mt-4 text-base font-bold tracking-tight text-zinc-50">{label}</h3>
        <p className="relative text-[11px] font-semibold uppercase tracking-[0.12em] text-cat-500/80">{audience}</p>
        <p className="relative mt-2 flex-1 text-sm leading-relaxed text-zinc-400">{BLURB[href] ?? ""}</p>
        <span className="relative mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-300 group-hover:text-cat-400">
          Open <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" aria-hidden />
        </span>
      </Link>
    </motion.li>
  );
}

export function HomeLaunchpad() {
  const snapshot = useSnapshot();
  const { kpis } = useFleet();
  const { data: alerts } = useAlerts({ includeAcknowledged: false });
  const critical = alerts.filter((a) => a.severity === "critical").length;

  let index = 0;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1400px] space-y-10 p-4 pb-16 sm:p-8">
        {/* Hero */}
        <section className="grid-bg relative overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-900/60 p-6 sm:p-10">
          <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-cat-500/20 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-32 left-1/3 size-80 rounded-full bg-status-info/10 blur-3xl" aria-hidden />
          <div className="relative grid gap-8 lg:grid-cols-[1.3fr_1fr] lg:items-end">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold text-zinc-300">
                <span className="relative size-2 rounded-full bg-status-ok pulse-ring" aria-hidden />
                {SITE_NAME} · {snapshot.shift} · {snapshot.clock}
              </p>
              <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-zinc-50 sm:text-5xl">
                The smart operator <br className="hidden sm:block" />
                <span className="text-gradient-cat">assistant</span> for CAT machines.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-relaxed text-zinc-400">
                Daily tasks, real-time safety, training, usage coaching and ML task-time estimates, from the cab to
                the owner&apos;s office.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/hmi"
                  className="bg-gradient-cat inline-flex h-12 items-center gap-2 rounded-xl px-5 text-sm font-bold text-ink-950 shadow-[0_10px_30px_-10px_rgb(255_205_17/0.7)] transition hover:brightness-110"
                >
                  Launch vehicle display <ArrowRight className="size-4" aria-hidden />
                </Link>
                <Link
                  href="/command"
                  className="inline-flex h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.04] px-5 text-sm font-semibold text-zinc-100 transition hover:bg-white/10"
                >
                  Command centre
                </Link>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Machines active" value={`${kpis.active}/${kpis.fleetSize}`} />
              <Stat label="Utilisation" value={`${Math.round(kpis.utilization)}%`} tone="text-cat-400" />
              <Stat
                label="Open alerts"
                value={alerts.length}
                tone={critical ? "text-status-crit" : alerts.length ? "text-status-warn" : "text-status-ok"}
              />
              <Stat
                label="Site risk"
                value={snapshot.riskScore}
                tone={snapshot.riskScore >= 65 ? "text-status-crit" : snapshot.riskScore >= 40 ? "text-status-warn" : "text-status-ok"}
              />
            </div>
          </div>
        </section>

        {NAV.map((group) => (
          <section key={group.id} aria-labelledby={`home-${group.id}`}>
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <h2 id={`home-${group.id}`} className="text-lg font-bold tracking-tight text-zinc-100">
                {group.label}
              </h2>
              {group.id === "internal" ? <span className="text-xs text-muted">For the demo presenter and developers</span> : null}
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {group.items
                .filter((item) => item.href !== "/")
                .map((item) => (
                  <SurfaceCard
                    key={item.href}
                    {...item}
                    accent={GROUP_ACCENT[group.id]}
                    featured={item.href === "/hmi"}
                    index={index++}
                  />
                ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
