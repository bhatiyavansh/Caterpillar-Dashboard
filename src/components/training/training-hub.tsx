"use client";

/**
 * Training hub.
 *
 * This is the one surface that should not feel like monitoring. It is about a
 * person getting better, so it leads with their progress, and the incidents
 * below are framed as lessons drawn from this site rather than as a fault log.
 */
import * as React from "react";
import Link from "next/link";
import { motion } from "motion/react";
import {
  Award,
  CalendarPlus,
  CircleCheck,
  Ghost,
  Gamepad2,
  Lock,
  PlayCircle,
  Target,
} from "lucide-react";
import type { Incident, TrainingModule } from "@/lib/api/contracts";
import { ALERT_SEVERITY } from "@/lib/status";
import { useIncidents, useTraining } from "@/lib/hooks/use-site";
import { Button } from "@/components/ui/primitives";
import { PageShell, Panel } from "@/components/ui/page";
import { SeverityChip } from "@/components/ui/status";
import { EmptyPanel, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

function ProgressRing({ value, size = 64 }: { value: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const done = value >= 100;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={done ? "#3ddc84" : "#ffcd11"}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 700ms ease" }}
      />
      <text
        x="50%"
        y="50%"
        dy="0.35em"
        textAnchor="middle"
        className={cn("font-mono font-bold", done ? "fill-status-ok" : "fill-zinc-50")}
        style={{ fontSize: size * 0.26 }}
      >
        {value}
      </text>
    </svg>
  );
}

function ModuleCard({ module, index }: { module: TrainingModule; index: number }) {
  const done = module.progress >= 100;
  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className={cn(
        "flex items-center gap-4 rounded border p-4",
        module.locked
          ? "border-white/8 bg-ink-900/60"
          : done
            ? "border-status-ok/30 bg-status-ok/[0.04]"
            : "border-white/12 bg-ink-850",
      )}
    >
      <ProgressRing value={module.progress} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className={cn("truncate text-sm font-bold", module.locked ? "text-muted" : "text-zinc-50")}>
            {module.title}
          </h3>
          {done ? (
            <CircleCheck className="size-4 shrink-0 text-status-ok" aria-label="Complete" />
          ) : module.locked ? (
            <Lock className="size-3.5 shrink-0 text-muted" aria-label="Locked" />
          ) : null}
        </div>
        <p className="mt-0.5 text-[11px] text-muted">
          {module.lessonsDone} of {module.lessons} lessons
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-zinc-400">{module.rationale}</p>
      </div>

      <Button
        variant={done ? "ghost" : module.locked ? "ghost" : "secondary"}
        size="sm"
        disabled={module.locked}
        className="shrink-0"
      >
        {done ? "Review" : module.locked ? "Locked" : "Continue"}
      </Button>
    </motion.article>
  );
}

function IncidentLesson({ incident }: { incident: Incident }) {
  const token = ALERT_SEVERITY[incident.severity];
  const when = new Date(incident.at).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <article className={cn("flex flex-col overflow-hidden rounded border bg-ink-850", token.border)}>
      {/* Replay poster */}
      <div className="relative aspect-video w-full overflow-hidden bg-ink-950">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 30% 60%, rgba(255,205,17,0.14), transparent 55%), repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 4px)",
          }}
          aria-hidden
        />
        <div className="absolute inset-0 grid place-items-center">
          <PlayCircle className={cn("size-10", token.text)} aria-hidden />
        </div>
        <span className="absolute left-2 top-2">
          <SeverityChip severity={incident.severity} size="sm" />
        </span>
        <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
          {incident.machineId} · {incident.zone}
        </span>
      </div>

      <div className="flex-1 space-y-1.5 px-3 py-2.5">
        <h3 className="text-sm font-bold leading-tight text-zinc-50">{incident.title}</h3>
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{when}</p>
        <p className="line-clamp-3 text-[11px] leading-relaxed text-zinc-300">{incident.summary}</p>
      </div>

      <div className="flex items-center gap-1.5 border-t border-white/8 p-2">
        <Button variant="secondary" size="sm" className="flex-1" disabled={!incident.replayable}>
          <PlayCircle className="size-3.5" aria-hidden />
          Replay
        </Button>
        <Button variant="ghost" size="sm">
          <Ghost className="size-3.5" aria-hidden />
          Expert run
        </Button>
      </div>
    </article>
  );
}

export function TrainingHub() {
  const { data: modules, loading } = useTraining();
  const { data: incidents } = useIncidents();

  if (loading) return <LoadingState label="Loading your training record…" className="h-full" />;

  const overall = modules.length
    ? Math.round(modules.reduce((sum, m) => sum + m.progress, 0) / modules.length)
    : 0;
  const complete = modules.filter((m) => m.progress >= 100).length;
  const lessonsLeft = modules.reduce((sum, m) => sum + (m.lessons - m.lessonsDone), 0);

  return (
    <PageShell>
        {/* The person, not the fleet */}
        <section className="flex flex-wrap items-center gap-5 rounded border border-white/10 bg-ink-900 px-5 py-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-cat-500 text-xl font-black text-ink-950">
            RS
          </span>
          <div className="min-w-0">
            <p className="label-xs">Operator record</p>
            <h1 className="text-lg font-bold leading-tight tracking-tight text-zinc-50">R. Subramanian</h1>
            <p className="text-xs text-muted">OP-1042 · Expert class · Excavator, dozer, loader endorsed</p>
          </div>

          <dl className="ml-auto flex flex-wrap items-center gap-5">
            {[
              { label: "Overall", value: `${overall}%`, icon: Target },
              { label: "Modules complete", value: `${complete}/${modules.length}`, icon: Award },
              { label: "Lessons left", value: lessonsLeft, icon: PlayCircle },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-center gap-2.5">
                <Icon className="size-4 text-cat-500" aria-hidden />
                <div>
                  <dt className="label-xs">{label}</dt>
                  <dd className="font-mono text-xl font-bold tabular-nums text-zinc-50">{value}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          {/* Skill path */}
          <Panel title="Skill path" meta="Sequenced from your own telemetry">
            <div className="space-y-2.5 p-3">
              {modules.map((m, i) => (
                <ModuleCard key={m.id} module={m} index={i} />
              ))}
            </div>
          </Panel>

          {/* Simulator */}
          <section className="flex flex-col gap-4">
            <div className="relative overflow-hidden rounded border border-cat-500/30 bg-ink-900 p-5">
              <div
                className="absolute inset-0 opacity-[0.07]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(-45deg, #ffcd11 0 12px, transparent 12px 24px)",
                }}
                aria-hidden
              />
              <div className="relative">
                <span className="grid size-11 place-items-center rounded bg-cat-500 text-ink-950">
                  <Gamepad2 className="size-6" aria-hidden />
                </span>
                <h2 className="mt-3 text-lg font-bold tracking-tight text-zinc-50">Machine simulator</h2>
                <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
                  Drive a 320 in the browser on this site&rsquo;s own terrain. Every incident below loads as a scenario,
                  and you can race a veteran operator&rsquo;s recorded run as a transparent ghost machine.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="primary" size="lg" asChild>
                    <Link href="/simulation">
                      <Gamepad2 className="size-5" aria-hidden />
                      Launch simulator
                    </Link>
                  </Button>
                  <Button variant="outline" size="lg">
                    <CalendarPlus className="size-4" aria-hidden />
                    Book an instructor
                  </Button>
                </div>

                <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/10 pt-3">
                  {[
                    { label: "Best cycle", value: "38 s" },
                    { label: "Expert cycle", value: "31 s" },
                    { label: "Smoothness", value: "82%" },
                  ].map((s) => (
                    <div key={s.label}>
                      <dt className="label-xs">{s.label}</dt>
                      <dd className="font-mono text-lg font-bold tabular-nums text-zinc-50">{s.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <div className="rounded border border-white/10 bg-ink-900 p-4">
              <p className="label-xs">Next instructor slot</p>
              <p className="mt-1 text-sm font-semibold text-zinc-100">
                Slope and stability control · Thursday 14:00
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                With A. Fernandes, 90 minutes, Zone B training pad. Two places left.
              </p>
              <Button variant="secondary" size="sm" className="mt-3 w-full">
                Request this slot
              </Button>
            </div>
          </section>
        </div>

        {/* Lessons from this site */}
        <Panel
          title="Lessons from this site"
          meta={`${incidents.filter((i) => i.replayable).length} incidents available to replay in 3D`}
        >
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
            {incidents.length ? (
              incidents.map((i) => <IncidentLesson key={i.id} incident={i} />)
            ) : (
              <EmptyPanel
                tone="good"
                title="No incidents to learn from"
                body="Nothing has been recorded on this site yet. Incidents captured by the safety system appear here automatically as replayable lessons."
                className="sm:col-span-2 xl:col-span-4"
              />
            )}
          </div>
        </Panel>
    </PageShell>
  );
}
