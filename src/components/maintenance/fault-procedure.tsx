"use client";

/**
 * Suggested fix for the top-ranked cause, run as a checklist.
 *
 * Steps unlock one at a time once the technician is on site, because the order
 * is the safety case (lockout before pressure relief before touching a hose).
 * The last step is not ticked by hand: the machine restarts and the telemetry
 * decides whether the repair held.
 */
import * as React from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  Package,
  Play,
  Truck,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  DIAGNOSIS,
  LABOUR_MIN,
  PARTS_LIST,
  PROCEDURE,
  TOOLS,
  phaseAtLeast,
  type FaultView,
  type StepId,
} from "@/lib/maintenance/hydraulic-leak";
import { useFaultStore } from "@/lib/maintenance/fault-store";
import { Button, Progress } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function FaultProcedure({
  view,
  focused,
  onFocus,
}: {
  view: FaultView;
  focused: StepId | null;
  onFocus: (id: StepId | null) => void;
}) {
  const { dispatch, tickStep, startVerify, close } = useFaultStore();
  const rec = view.record;
  const { phase } = view;
  const confirmed = phaseAtLeast(phase, "detected");
  const onSite = phaseAtLeast(phase, "repairing");
  const top = DIAGNOSIS[0];

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="label-xs !text-zinc-300">Suggested fix</h2>
          <p className="mt-0.5 truncate text-sm font-semibold text-zinc-100">
            Replace hose H-3 <span className="font-normal text-muted">· for “{top.cause.title}”</span>
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-300">
          <Wrench className="size-3.5 text-cat-500" aria-hidden />~{LABOUR_MIN} min
        </span>
      </div>

      {/* Dispatch */}
      <div className="border-b border-white/10 px-4 py-3">
        {!confirmed ? (
          <p className="text-xs text-muted">The repair plan is drafted once the leak is confirmed.</p>
        ) : rec.dispatchedAt === undefined ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-xs text-zinc-300">
              Issue work order <span className="font-mono text-cat-500">{rec.workOrder}</span> and send the technician with the parts below.
            </p>
            <Button variant="primary" size="sm" onClick={dispatch}>
              <Truck className="size-4" aria-hidden />
              Dispatch technician
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 text-xs">
            {onSite ? (
              <CheckCircle2 className="size-4 shrink-0 text-status-ok" aria-hidden />
            ) : (
              <Loader2 className="size-4 shrink-0 animate-spin text-cat-500" aria-hidden />
            )}
            <span className="text-zinc-200">
              <span className="font-semibold">{rec.technician}</span> · work order{" "}
              <span className="font-mono text-cat-500">{rec.workOrder}</span>
            </span>
            <span className="ml-auto text-muted">
              {onSite
                ? `on site ${view.arrivedAt ? clock(view.arrivedAt) : ""}`
                : `on site in ${Math.max(0, Math.ceil(((view.arrivedAt ?? 0) - view.now) / 1000))} s`}
            </span>
          </div>
        )}
      </div>

      {/* Steps */}
      <ol className="divide-y divide-white/5">
        {PROCEDURE.map((step, i) => {
          const doneAt = step.verified ? view.verifiedAt : rec.steps[step.id];
          const isNext = view.nextStep === step.id;
          const locked = !onSite || (!doneAt && !isNext);
          const testing = step.verified && phaseAtLeast(phase, "verifying") && phase !== "closed";
          const open = isNext || testing || focused === step.id;
          return (
            <li key={step.id} className={cn("px-4 py-2.5 transition-colors", isNext && "bg-cat-500/[0.06]")}>
              <button
                type="button"
                onClick={() => onFocus(focused === step.id ? null : step.id)}
                className="flex w-full items-start gap-2.5 text-left"
                aria-expanded={open}
              >
                {doneAt ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-status-ok" aria-hidden />
                ) : isNext ? (
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-cat-500 text-[9px] font-black text-ink-950">
                    {i + 1}
                  </span>
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-zinc-600" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm font-semibold", locked && !doneAt ? "text-zinc-500" : "text-zinc-100")}>
                    {step.title}
                    {step.verified ? (
                      <span className="ml-2 rounded bg-status-info/15 px-1.5 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wider text-status-info">
                        telemetry check
                      </span>
                    ) : null}
                  </span>
                </span>
                {doneAt ? <span className="shrink-0 font-mono text-[10px] text-muted">{clock(doneAt)}</span> : null}
              </button>

              {open ? (
                <div className="mt-2 space-y-2 pl-6.5">
                  <p className="text-xs leading-relaxed text-zinc-300">{step.detail}</p>
                  {step.caution ? (
                    <p className="flex gap-2 rounded border border-status-warn/30 bg-status-warn/8 px-2.5 py-2 text-[11px] leading-relaxed text-status-warn">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                      {step.caution}
                    </p>
                  ) : null}

                  {isNext && !step.verified ? (
                    <Button size="sm" variant="primary" onClick={() => tickStep(step.id)}>
                      <Check className="size-4" aria-hidden />
                      Mark done
                    </Button>
                  ) : null}

                  {step.verified && isNext && phase === "repairing" ? (
                    <Button size="sm" variant="primary" onClick={startVerify}>
                      <Play className="size-4" aria-hidden />
                      Restart and run test cycle
                    </Button>
                  ) : null}

                  {step.verified && view.verify ? <VerifyChecks view={view} /> : null}

                  {step.verified && phase === "verified" ? (
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="primary">
                          <CheckCircle2 className="size-4" aria-hidden />
                          Close work order {rec.workOrder}
                        </Button>
                      }
                      title={`Close ${rec.workOrder}?`}
                      description="This returns EXC001 to service and writes the service report from the work log and the test-cycle telemetry."
                      confirmLabel="Close and write report"
                      onConfirm={close}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Parts and tools */}
      <div className="grid gap-4 border-t border-white/10 px-4 py-3 sm:grid-cols-2">
        <div>
          <p className="label-xs mb-1.5 flex items-center gap-1.5">
            <Package className="size-3.5" aria-hidden /> Parts to bring
          </p>
          <ul className="space-y-1 text-xs">
            {PARTS_LIST.map((p) => (
              <li key={p.ref} className="flex gap-2">
                <span className="w-10 shrink-0 font-mono text-cat-500">{p.qty}</span>
                <span className="min-w-0 text-zinc-300">
                  {p.name} <span className="font-mono text-[10px] text-muted">{p.ref}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="label-xs mb-1.5 flex items-center gap-1.5">
            <Wrench className="size-3.5" aria-hidden /> Tools and PPE
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-zinc-300 marker:text-zinc-600">
            {TOOLS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function VerifyChecks({ view }: { view: FaultView }) {
  const v = view.verify!;
  const done = v.progress >= 1;
  return (
    <div className="rounded border border-white/10 bg-ink-850 p-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-zinc-200">
          {done ? (v.passed ? "Test cycle passed" : "Test cycle failed") : "Test cycle running…"}
        </span>
        <span className="font-mono text-muted">{Math.round(v.progress * 100)}%</span>
      </div>
      <Progress
        value={v.progress * 100}
        className="mt-1.5 h-1.5"
        barClassName={done ? (v.passed ? "bg-status-ok" : "bg-status-crit") : "bg-status-info"}
        label="Test cycle progress"
      />
      <ul className="mt-2 space-y-1">
        {v.checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2 text-[11px]">
            {c.pass ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-status-ok" aria-hidden />
            ) : done ? (
              <XCircle className="size-3.5 shrink-0 text-status-crit" aria-hidden />
            ) : (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted" aria-hidden />
            )}
            <span className="min-w-0 flex-1 text-zinc-300">{c.label}</span>
            <span className="shrink-0 font-mono text-zinc-400">{c.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
