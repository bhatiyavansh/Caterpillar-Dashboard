/**
 * The two documents a breakdown produces.
 *
 *   Breakdown report  written the moment the fault is confirmed: what failed,
 *                     why we think so, what to bring.
 *   Service report    written when the work order closes: what was done, with
 *                     what, and the telemetry that proves it worked.
 *
 * Every figure comes from `facts`, which are computed, never generated. The
 * language model only writes the summary paragraph, the server rejects any
 * summary quoting a number that is not in the facts, and the template below is
 * what ships when there is no model or it strays.
 */
import {
  beforeAfter,
  DIAGNOSIS,
  FEATURES,
  LABOUR_MIN,
  MACHINE,
  OIL_LOST_L,
  PARTS_LIST,
  PROCEDURE,
  TOOLS,
  type FaultRecord,
  type FaultView,
} from "./hydraulic-leak";
import type { Citation, ReportDoc, ReportKind } from "./fault-store";

export const PIPELINE: Record<ReportKind, string[]> = {
  breakdown: [
    "Collecting telemetry window",
    "Running detection rules",
    "Ranking root causes",
    "Retrieving service procedures",
    "Drafting summary",
    "Checking summary against the facts",
  ],
  service: [
    "Collecting work-order log",
    "Comparing before and after readings",
    "Retrieving close-out requirements",
    "Drafting summary",
    "Checking summary against the facts",
  ],
};

/** Which stage the server call happens in; earlier stages are local. */
export const REMOTE_STAGE: Record<ReportKind, number> = { breakdown: 3, service: 2 };

export const RETRIEVAL_QUERY: Record<ReportKind, string> = {
  breakdown: "hydraulic leak wet hoses visible leaks fluid under pressure skin hydraulic warning work order",
  service: "equipment inspection repair return to service defects corrected",
};

export type Facts = Record<string, string | number>;

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/* ------------------------------------------------------------ Breakdown */

export function breakdownFacts(view: FaultView): Facts {
  const top = DIAGNOSIS[0];
  return {
    report_id: view.record.id,
    machine: MACHINE.label,
    zone: MACHINE.zone,
    operator: MACHINE.operator,
    detected_at: clock(view.detectedAt),
    early_warning_lead_s: Math.round((view.detectedAt - view.predictiveAt) / 1000),
    top_cause: top.cause.title,
    top_cause_confidence_pct: Math.round(top.probability * 100),
    second_cause: DIAGNOSIS[1].cause.title,
    pressure_normal_psi: Math.round(FEATURES.baselinePressure),
    pressure_at_fault_psi: Math.round(FEATURES.pressureAtFault),
    pressure_drop_pct: Math.round(FEATURES.pressureDropPct),
    level_rate_pct_per_min: Number(FEATURES.levelRate.toFixed(1)),
    boom_drift_mm_per_min: Math.round(FEATURES.drift),
    oil_lost_l: OIL_LOST_L,
    labour_min: LABOUR_MIN,
    machine_state: "Safed: boom on the ground, engine off. Do not operate.",
  };
}

export function breakdownTemplate(f: Facts): string {
  return (
    `${f.machine} lost hydraulic pressure at ${f.detected_at} while working ${f.zone}. ` +
    `Pressure fell ${f.pressure_drop_pct}% below normal and the tank level dropped at ${Math.abs(Number(f.level_rate_pct_per_min))}%/min. ` +
    `The most likely cause is a ${String(f.top_cause).toLowerCase()} (${f.top_cause_confidence_pct}% confidence). ` +
    `About ${f.oil_lost_l} L of oil was lost before the operator shut down. ` +
    `The machine is safe and must not be operated until the hose is replaced, which should take about ${f.labour_min} minutes.`
  );
}

/* -------------------------------------------------------------- Service */

export function serviceFacts(rec: FaultRecord): Facts {
  const { before, after } = beforeAfter(rec);
  const start = rec.dispatchedAt ?? rec.startedAt;
  const end = rec.closedAt ?? Date.now();
  return {
    work_order: rec.workOrder,
    report_id: rec.id,
    machine: MACHINE.label,
    technician: rec.technician ?? "",
    repair: "Replaced boom cylinder head-end hose H-3 and topped up hydraulic oil",
    steps_completed: PROCEDURE.filter((s) => rec.steps[s.id] !== undefined).length,
    steps_total: PROCEDURE.length,
    elapsed: mmss(end - start),
    pressure_before_psi: before.pressure,
    pressure_after_psi: after.pressure,
    drift_before_mm_per_min: before.drift,
    drift_after_mm_per_min: after.drift,
    level_after_pct: after.level,
    oil_added_l: Math.ceil(OIL_LOST_L + 2),
    result: "Test cycle passed. Returned to service.",
  };
}

export function serviceTemplate(f: Facts): string {
  return (
    `${f.technician} closed ${f.work_order} on ${f.machine} after ${f.steps_completed} of ${f.steps_total} procedure steps. ` +
    `${f.repair}, adding ${f.oil_added_l} L. ` +
    `On the test cycle pressure recovered from ${f.pressure_before_psi} to ${f.pressure_after_psi} psi and boom drift fell from ${f.drift_before_mm_per_min} to ${f.drift_after_mm_per_min} mm/min. ` +
    `The machine is cleared to return to service.`
  );
}

/* -------------------------------------------------------------- Output */

/** Plain Markdown, for copy and download. */
export function reportMarkdown(kind: ReportKind, rec: FaultRecord, view: FaultView, doc: ReportDoc): string {
  const lines: string[] = [];
  const cite = (c: Citation[] | undefined) =>
    c?.length ? ["", "## References", ...c.map((x) => `- ${x.citation}: ${x.title}`)] : [];

  if (kind === "breakdown") {
    const f = breakdownFacts(view);
    lines.push(
      `# Breakdown report ${rec.id}`,
      "",
      `**Machine:** ${MACHINE.label}  `,
      `**Location:** ${MACHINE.zone}  `,
      `**Operator:** ${MACHINE.operator}  `,
      `**Detected:** ${f.detected_at}  `,
      `**Status:** ${f.machine_state}`,
      "",
      "## Summary",
      doc.summary ?? breakdownTemplate(f),
      "",
      "## Telemetry at failure",
      "| Reading | Normal | At failure |",
      "|---|---|---|",
      `| Pump pressure | ${f.pressure_normal_psi} psi | ${f.pressure_at_fault_psi} psi |`,
      `| Tank level trend | steady | ${f.level_rate_pct_per_min} %/min |`,
      `| Boom drift | < 2 mm/min | ${f.boom_drift_mm_per_min} mm/min |`,
      `| Oil lost | — | ≈ ${f.oil_lost_l} L |`,
      "",
      "## Probable causes",
      ...DIAGNOSIS.map(
        (d, i) =>
          `${i + 1}. **${d.cause.title}** (${Math.round(d.probability * 100)}%): ${d.evidence
            .map((e) => `${e.matched ? "✓" : "✗"} ${e.label}`)
            .join("; ")}. *To confirm:* ${d.cause.confirm}`,
      ),
      "",
      `## Recommended repair (about ${LABOUR_MIN} min)`,
      ...PROCEDURE.map((s, i) => `${i + 1}. **${s.title}.** ${s.detail}${s.caution ? ` ⚠ ${s.caution}` : ""}`),
      "",
      "## Parts to bring",
      ...PARTS_LIST.map((p) => `- ${p.qty} × ${p.name} (${p.ref})`),
      "",
      "## Tools",
      ...TOOLS.map((t) => `- ${t}`),
      "",
      "## Environment",
      `Around ${OIL_LOST_L} L of hydraulic oil reached the ground. Contain it with spill pads and remove contaminated soil to the site's hydrocarbon waste bin.`,
      ...cite(doc.citations),
    );
  } else {
    const f = serviceFacts(rec);
    const { before, after, baseline } = beforeAfter(rec);
    lines.push(
      `# Service report ${rec.workOrder}`,
      "",
      `**Machine:** ${MACHINE.label}  `,
      `**Breakdown report:** ${rec.id}  `,
      `**Technician:** ${f.technician}  `,
      `**Time on job:** ${f.elapsed}  `,
      `**Result:** ${f.result}`,
      "",
      "## Summary",
      doc.summary ?? serviceTemplate(f),
      "",
      "## Work performed",
      ...PROCEDURE.map((s) => {
        const at = rec.steps[s.id];
        return `- ${at ? `✓ ${clock(at)}` : "✗ not done"} · ${s.title}`;
      }),
      "",
      "## Parts used",
      ...PARTS_LIST.map((p) => `- ${p.qty} × ${p.name} (${p.ref})`),
      "",
      "## Verification",
      "| Reading | Normal | Before repair | After repair |",
      "|---|---|---|---|",
      `| Pump pressure | ${baseline.pressure} psi | ${before.pressure} psi | ${after.pressure} psi |`,
      `| Tank level | ${baseline.level} % | ${before.level} % | ${after.level} % |`,
      `| Oil temperature | ${baseline.temp} °C | ${before.temp} °C | ${after.temp} °C |`,
      `| Boom drift | ${baseline.drift} mm/min | ${before.drift} mm/min | ${after.drift} mm/min |`,
      "",
      "## Follow-up",
      "- Inspect the matching rod-end hose H-4 at the next 500-hour service; it is the same age and routing.",
      "- Send the removed hose for failure analysis (tagged on removal).",
      ...cite(doc.citations),
    );
  }
  return lines.join("\n");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Minimal Markdown → HTML for the print window: headings, lists, tables, bold. */
export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let table: string[][] | null = null;
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/ {2}$/, "<br>");
  const flush = () => {
    if (list) out.push(`</${list}>`);
    list = null;
    if (table) {
      const [head, , ...rows] = table;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
    }
    table = null;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("|")) {
      if (list) flush();
      (table ??= []).push(line.slice(1, -1).split("|").map((c) => c.trim()));
      continue;
    }
    if (table) flush();
    const ul = line.match(/^- (.*)/);
    const ol = line.match(/^\d+\. (.*)/);
    if (ul || ol) {
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        flush();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
      continue;
    }
    flush();
    if (line.startsWith("# ")) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (line.startsWith("## ")) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (line) out.push(`<p>${inline(raw)}</p>`);
  }
  flush();
  return out.join("\n");
}

export function reportHtml(title: string, md: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:13px/1.5 -apple-system,Segoe UI,Inter,sans-serif;color:#111;max-width:780px;margin:32px auto;padding:0 20px}
h1{font-size:20px;border-bottom:4px solid #ffcd11;padding-bottom:6px}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;margin-top:22px;color:#333}
table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f4f4f4}
li{margin:3px 0}p{margin:4px 0}
footer{margin-top:28px;font-size:11px;color:#777;border-top:1px solid #ddd;padding-top:8px}
</style></head><body>${mdToHtml(md)}<footer>Generated by CAT Copilot · ${new Date().toLocaleString("en-GB")}</footer></body></html>`;
}
