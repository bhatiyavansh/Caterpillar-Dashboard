"use client";

/**
 * The documents panel: shows each report's pipeline while it runs, then the
 * document itself, ready to print, download or paste into a ticket.
 */
import * as React from "react";
import { Check, Copy, Download, FileText, Loader2, Lock, Printer, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { FaultView } from "@/lib/maintenance/hydraulic-leak";
import { useFaultStore, type ReportKind } from "@/lib/maintenance/fault-store";
import { mdToHtml, PIPELINE, reportHtml, reportMarkdown } from "@/lib/maintenance/report";
import { Button } from "@/components/ui/primitives";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils";

const TITLES: Record<ReportKind, string> = { breakdown: "Breakdown report", service: "Service report" };

export function FaultReports({ view }: { view: FaultView }) {
  const reports = useFaultStore((s) => s.reports);
  const [picked, setTab] = React.useState<ReportKind | null>(null);
  // Follow the work until someone picks a tab: once the service report
  // starts, that is the one to watch.
  const tab: ReportKind = picked ?? (reports.service.status !== "idle" ? "service" : "breakdown");

  const doc = reports[tab];
  const rec = view.record;
  const md = doc.status === "ready" ? reportMarkdown(tab, rec, view, doc) : "";
  const fileName = `${tab === "breakdown" ? rec.id : rec.workOrder}-${tab}-report`;

  const print = () => {
    const w = window.open("", "_blank", "width=860,height=1000");
    if (!w) {
      toast.error("Pop-up blocked. Allow pop-ups to print the report.");
      return;
    }
    w.document.write(reportHtml(`${TITLES[tab]} ${tab === "breakdown" ? rec.id : rec.workOrder}`, md));
    w.document.close();
    w.focus();
    w.print();
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${fileName}.md` });
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      toast.success(`${TITLES[tab]} copied`);
    } catch {
      toast.error("Clipboard not available here.");
    }
  };

  return (
    <section className="panel flex min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
        <h2 className="label-xs !text-zinc-300">Reports</h2>
        <Tabs value={tab} onValueChange={(v) => setTab(v as ReportKind)}>
          <TabsList>
            {(["breakdown", "service"] as const).map((k) => (
              <TabsTrigger key={k} value={k}>
                <span className="inline-flex items-center gap-1.5">
                  {reports[k].status === "ready" ? (
                    <Check className="size-3.5 text-status-ok" aria-hidden />
                  ) : reports[k].status === "running" ? (
                    <Loader2 className="size-3.5 animate-spin text-cat-500" aria-hidden />
                  ) : k === "service" ? (
                    <Lock className="size-3 text-muted" aria-hidden />
                  ) : null}
                  {TITLES[k]}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {doc.status === "idle" ? (
        <div className="grid flex-1 place-items-center px-6 py-10 text-center">
          <div>
            <FileText className="mx-auto size-8 text-zinc-600" aria-hidden />
            <p className="mt-2 text-sm font-semibold text-zinc-300">
              {tab === "breakdown" ? "Waiting for confirmation" : "Written when the work order closes"}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted">
              {tab === "breakdown"
                ? "The breakdown report is drafted automatically as soon as the detection rule confirms the fault."
                : "It is built from the work log and the test-cycle telemetry, so there is nothing to type up."}
            </p>
          </div>
        </div>
      ) : doc.status === "running" ? (
        <Pipeline kind={tab} stage={doc.stage} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                doc.source === "llm" ? "bg-status-info/15 text-status-info" : "bg-white/8 text-zinc-300",
              )}
              title={
                doc.source === "llm"
                  ? "Summary drafted by the local model and checked against the computed facts."
                  : "Local model unavailable or its draft failed the fact check, so the summary is the template."
              }
            >
              <Sparkles className="size-3" aria-hidden />
              {doc.source === "llm" ? "Summary by local model · fact-checked" : "Template summary"}
            </span>
            {doc.citations?.length ? (
              <span className="text-[10px] text-muted">{doc.citations.length} manual references</span>
            ) : null}
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={copy} aria-label="Copy as Markdown">
                <Copy className="size-3.5" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" onClick={download} aria-label="Download Markdown">
                <Download className="size-3.5" aria-hidden />
              </Button>
              <Button variant="secondary" size="sm" onClick={print}>
                <Printer className="size-3.5" aria-hidden />
                Print / PDF
              </Button>
            </div>
          </div>
          <article
            className={cn(
              "max-h-[34rem] flex-1 overflow-y-auto px-5 py-4 text-xs leading-relaxed text-zinc-300",
              "[&_h1]:mb-2 [&_h1]:border-b-2 [&_h1]:border-cat-500 [&_h1]:pb-1.5 [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-zinc-50",
              "[&_h2]:mb-1.5 [&_h2]:mt-4 [&_h2]:text-[10px] [&_h2]:font-bold [&_h2]:uppercase [&_h2]:tracking-[0.14em] [&_h2]:text-zinc-400",
              "[&_strong]:text-zinc-100 [&_p]:my-1 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
              "[&_table]:my-1.5 [&_table]:w-full [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_td]:font-mono",
              "[&_th]:border [&_th]:border-white/10 [&_th]:bg-white/5 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
            )}
            // Markdown is built from our own facts and escaped in mdToHtml.
            dangerouslySetInnerHTML={{ __html: mdToHtml(md) }}
          />
        </>
      )}
    </section>
  );
}

function Pipeline({ kind, stage }: { kind: ReportKind; stage: number }) {
  return (
    <ol className="flex-1 space-y-2.5 px-5 py-5">
      {PIPELINE[kind].map((label, i) => {
        const done = i < stage;
        const active = i === stage;
        return (
          <li key={label} className="flex items-center gap-3 text-sm">
            {done ? (
              <Check className="size-4 shrink-0 text-status-ok" aria-hidden />
            ) : active ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-cat-500" aria-hidden />
            ) : (
              <span className="grid size-4 shrink-0 place-items-center">
                <span className="size-1.5 rounded-full bg-zinc-600" />
              </span>
            )}
            <span className={cn(done ? "text-zinc-400" : active ? "font-semibold text-zinc-100" : "text-zinc-600")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}
