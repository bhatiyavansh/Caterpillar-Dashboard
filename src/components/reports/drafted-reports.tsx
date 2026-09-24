"use client";

/**
 * Work orders and incidents the Copilot backend drafted — including the ones
 * raised from the twin's X-ray view. Each carries the view it came from
 * (`source_view`), so a supervisor opening the report later can jump straight
 * back to the same X-ray of the same component.
 */

import { FileText, ScanLine, Wrench } from "lucide-react";
import Link from "next/link";
import { Panel } from "@/components/ui/page";
import { EmptyPanel } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/primitives";
import { useCopilotRecords, xrayHref } from "@/lib/hooks/use-xray";
import { cn } from "@/lib/utils";

export function DraftedReports({ kind }: { kind: "work_order" | "incident" }) {
  const state = useCopilotRecords(kind);
  const title = kind === "work_order" ? "Drafted work orders" : "Filed incident reports";
  const Icon = kind === "work_order" ? Wrench : FileText;

  return (
    <div id="drafted" className="scroll-mt-20">
      <Panel
        title={title}
        meta={state.status === "ready" ? `${state.records.length} from the Copilot backend` : state.status === "offline" ? "backend offline" : "loading"}
      >
        {state.status === "offline" ? (
          <EmptyPanel
            title="Copilot backend offline"
            body="Drafted reports live in the backend's records store. Start it (cd backend && uv run python -m copilot) to see them here."
          />
        ) : state.records.length === 0 ? (
          <EmptyPanel
            title={state.status === "loading" ? "Loading…" : "Nothing drafted yet"}
            body="Raise one from a machine's X-ray view in the digital twin, or ask the assistant."
          />
        ) : (
          <ul className="divide-y divide-white/6">
            {state.records.map((r) => {
              const draft = (r.draft ?? {}) as { title?: string; priority?: string; summary?: string; description?: string };
              const view = r.source_view;
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-zinc-300">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-[11px] text-muted">{r.id}</span>
                      <span className="truncate text-sm font-semibold text-zinc-100">{draft.title ?? r.id}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{draft.description ?? draft.summary}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {r.machine_id}
                      {r.component ? ` · ${String(r.component).replace(/_/g, " ")}` : ""}
                      {draft.priority ? ` · priority ${draft.priority}` : ""} · {r.status} · drafted by {r.draft_source ?? "—"}
                    </p>
                  </div>
                  {view ? (
                    <Link
                      href={xrayHref(view.machine_id, view.component)}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "sm" }),
                        "shrink-0 border-[#62d0ff]/35 text-[#8fdcff] hover:border-[#62d0ff]/70 hover:bg-[#62d0ff]/10",
                      )}
                    >
                      <ScanLine className="size-3.5" aria-hidden />
                      Reopen X-ray
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
