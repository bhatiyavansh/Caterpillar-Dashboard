"use client";

/**
 * X-ray inspection UI.
 *
 *  - `XrayPanel` sits in the HUD: which machine is open, a chip per component
 *    (so everything is reachable without aiming at a mesh), close.
 *  - `XrayAnchor` (in the Canvas) marks the selected component and projects
 *    it to the screen; `XrayPopoverLayer` (over the stage) holds the
 *    `ComponentCard` beside it: live reading, forecast health, open issues,
 *    and the fix path.
 *  - `ReportFlow` is that fix path: context assembled from the component
 *    -> the backend's own `create_work_order` / `create_incident` tool is
 *    prepared -> the draft preview is shown -> confirm executes it -> the
 *    drafted document comes back, tagged with this X-ray view.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { AlertTriangle, CheckCircle2, FileText, Loader2, ScanLine, Wrench, X } from "lucide-react";
import type { MachineKind } from "@/types/twin";
import { MACHINES } from "@/lib/twin/simulation";
import { componentForIssue, componentSpec, componentsFor, type ComponentSpec } from "@/lib/twin/components";
import { attitudeToQuat } from "@/lib/twin/physics/math";
import { useAnomalies, useMaintenance } from "@/lib/hooks/use-site";
import {
  ActionUnavailable,
  confirmAction,
  prepareAction,
  type ActionTool,
  type DraftedRecord,
  type PendingAction,
} from "@/lib/api/actions";
import { useTwinStore } from "@/store/twinStore";
import { cn } from "@/lib/utils";

function kindOfTwin(id: string | null | undefined): MachineKind | null {
  return MACHINES.find((m) => m.id === id)?.kind ?? null;
}

/* ================================================================ HUD strip */

export function XrayPanel({ compact }: { compact?: boolean }) {
  const xray = useTwinStore((s) => s.xray);
  const select = useTwinStore((s) => s.selectComponent);
  const close = useTwinStore((s) => s.closeXray);
  if (!xray) return null;
  const kind = kindOfTwin(xray.shownOn);
  const parts = kind ? componentsFor(kind) : [];
  return (
    <section
      aria-label="X-ray inspection"
      className={cn("panel-raised pointer-events-auto w-full max-w-[640px] px-3 py-2.5", compact && "px-2 py-2")}
    >
      <header className="flex items-center gap-2">
        <ScanLine className="size-4 text-[#62d0ff]" aria-hidden />
        <p className="text-[11px] font-bold tracking-[0.18em] text-[#62d0ff]">X-RAY</p>
        <p className="truncate text-xs font-semibold text-zinc-100">{xray.machineId}</p>
        {xray.shownOn && xray.shownOn !== xray.machineId ? (
          <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-zinc-400">
            shown on the {xray.shownOn} model
          </span>
        ) : null}
        <button
          type="button"
          onClick={close}
          className="ml-auto grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label="Close X-ray"
        >
          <X className="size-4" />
        </button>
      </header>
      {kind ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {parts.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => select(xray.componentId === p.id ? null : p.id)}
              aria-pressed={xray.componentId === p.id}
              className={cn(
                "rounded-lg border px-2 py-1 text-[11px] font-medium transition",
                xray.componentId === p.id
                  ? "border-[#ffb020] bg-[#ffb020]/15 text-[#ffcf6b]"
                  : "border-white/10 bg-white/5 text-zinc-300 hover:border-white/25",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-400">
          {xray.machineId} is not modelled in the 3D twin (it simulates one machine of each kind). Its reports and
          forecasts are on the fleet pages.
        </p>
      )}
      {kind && !xray.componentId ? (
        <p className="mt-1.5 text-[11px] text-zinc-500">Click an assembly on the machine, or pick one above.</p>
      ) : null}
    </section>
  );
}

/* ================================================================ 3D anchor */

/**
 * Screen position of the selected component, written every frame by the
 * anchor inside the Canvas and read by the DOM popover on its own rAF loop —
 * the same pattern as the machine labels, rather than drei's <Html>, which
 * mounts a React root per popover and races React 19's renderer.
 */
const anchorSlot = { x: 0, y: 0, visible: false };

const q = new THREE.Quaternion();
const v = new THREE.Vector3();

export function XrayAnchor() {
  const xray = useTwinStore((s) => s.xray);
  const engine = useTwinStore((s) => s.engine);
  const size = useThree((s) => s.size);
  const marker = useRef<THREE.Mesh>(null);
  const kind = kindOfTwin(xray?.shownOn);
  const spec = kind ? componentSpec(kind, xray?.componentId) : undefined;

  useFrame(({ camera }) => {
    const m = marker.current;
    if (!m || !xray?.shownOn || !spec) {
      anchorSlot.visible = false;
      return;
    }
    const t = engine.telemetryOrPrimary(xray.shownOn);
    const r = attitudeToQuat(t.heading, t.pitch, t.roll);
    q.set(r.x, r.y, r.z, r.w);
    v.set(spec.focus.x, spec.focus.y, spec.focus.z).applyQuaternion(q);
    m.position.set(t.x + v.x, t.y + v.y, t.z + v.z);
    v.copy(m.position).project(camera);
    anchorSlot.visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
    anchorSlot.x = (v.x * 0.5 + 0.5) * size.width;
    anchorSlot.y = (-v.y * 0.5 + 0.5) * size.height;
  });

  if (!xray || !spec) return null;
  return (
    <mesh ref={marker} raycast={() => null}>
      <sphereGeometry args={[0.16, 16, 12]} />
      <meshBasicMaterial color="#ffb020" toneMapped={false} depthTest={false} transparent />
    </mesh>
  );
}

/** DOM layer: the component card, following the anchor. Mount over the stage. */
export function XrayPopoverLayer() {
  const xray = useTwinStore((s) => s.xray);
  const box = useRef<HTMLDivElement>(null);
  const kind = kindOfTwin(xray?.shownOn);
  const spec = kind ? componentSpec(kind, xray?.componentId) : undefined;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = box.current;
      const parent = el?.parentElement;
      if (el && parent) {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const pw = parent.clientWidth;
        const ph = parent.clientHeight;
        // Beside the component, on whichever side has room; kept on stage.
        const right = anchorSlot.x + 28 + w < pw - 8;
        const x = right ? anchorSlot.x + 28 : anchorSlot.x - 28 - w;
        const y = Math.min(Math.max(anchorSlot.y - h / 2, 8), ph - h - 8);
        // Whole pixels, and only when it moves: no sub-pixel shimmer on text.
        const next = `translate(${Math.round(Math.max(8, x))}px, ${Math.round(y)}px)`;
        if (el.style.transform !== next) el.style.transform = next;
        el.style.opacity = anchorSlot.visible ? "1" : "0";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!xray || !spec || !kind) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      <div ref={box} className="pointer-events-auto absolute left-0 top-0 transition-opacity duration-150">
        <ComponentCard machineId={xray.machineId} shownOn={xray.shownOn} kind={kind} spec={spec} />
      </div>
    </div>
  );
}

/* ============================================================ component card */

interface Issue {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
}

function ComponentCard({
  machineId,
  shownOn,
  kind,
  spec,
}: {
  machineId: string;
  shownOn: string | null;
  kind: MachineKind;
  spec: ComponentSpec;
}) {
  const select = useTwinStore((s) => s.selectComponent);
  // Readings come from the live machine when the twin simulates it.
  const live = useTwinStore((s) => s.snapshot.machines.find((m) => m.machineId === shownOn) ?? null);
  const alerts = useTwinStore((s) => s.snapshot.alerts);
  const { data: maintenance } = useMaintenance();
  const { data: anomalies } = useAnomalies();

  const readings = useMemo(
    () => (live && machineId === shownOn && spec.reading ? spec.reading(live) : []),
    [live, machineId, shownOn, spec],
  );

  const health = useMemo(() => {
    if (!spec.maintenance) return null;
    return (
      maintenance.find(
        (m) => m.machineId === machineId && componentForIssue(kind, { text: m.component }) === spec.maintenance,
      ) ?? null
    );
  }, [maintenance, machineId, kind, spec.maintenance]);

  const issues: Issue[] = useMemo(() => {
    const out: Issue[] = [];
    for (const a of alerts) {
      if (a.machineId !== machineId) continue;
      if (componentForIssue(kind, { alertKind: a.kind }) !== spec.id) continue;
      out.push({ id: a.id, title: a.title, detail: a.recommendation ?? a.message, severity: a.severity });
    }
    for (const an of anomalies) {
      if (an.machineId !== machineId) continue;
      if (componentForIssue(kind, { pattern: an.pattern }) !== spec.id) continue;
      out.push({ id: an.id, title: an.title, detail: an.deviation, severity: an.severity });
    }
    return out.slice(0, 4);
  }, [alerts, anomalies, machineId, kind, spec.id]);

  /** What the report says: component, reading, deviation — assembled, not typed. */
  const context = useMemo(() => {
    const parts = [
      `${spec.label} on ${machineId}`,
      ...readings.filter((r) => r.tone !== "ok").map((r) => `${r.label.toLowerCase()} ${r.value}`),
      health ? `forecast health ${Math.round(health.healthPct)}%, service ${health.dueLabel.toLowerCase()}` : null,
      ...issues.map((i) => `${i.title}${i.detail ? ` (${i.detail})` : ""}`),
    ].filter(Boolean);
    return parts.join("; ").slice(0, 390);
  }, [spec.label, machineId, readings, health, issues]);

  return (
    <div className="panel-raised w-[320px] overflow-hidden text-left shadow-2xl">
      <header className="flex items-start gap-2 border-b border-white/10 px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.16em] text-[#ffb020]">{machineId}</p>
          <h3 className="truncate text-sm font-semibold text-zinc-50">{spec.label}</h3>
        </div>
        <button
          type="button"
          onClick={() => select(null)}
          className="grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
          aria-label="Close component"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="space-y-3 px-3.5 py-3">
        {readings.length ? (
          <dl className="grid grid-cols-2 gap-2">
            {readings.map((r) => (
              <div key={r.label} className="rounded-lg bg-white/4 px-2.5 py-1.5">
                <dt className="text-[10px] text-zinc-500">{r.label}</dt>
                <dd
                  className={cn(
                    "font-mono text-sm tabular-nums",
                    r.tone === "crit" ? "text-status-crit" : r.tone === "warn" ? "text-status-warn" : "text-zinc-100",
                  )}
                >
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[11px] text-zinc-500">No live signal backs this assembly.</p>
        )}

        {spec.maintenance ? (
          <div>
            <div className="flex items-baseline justify-between text-[11px]">
              <span className="text-zinc-400">Forecast health · {spec.maintenance.replace("_", " ")}</span>
              <span className="font-mono tabular-nums text-zinc-100">
                {health ? `${Math.round(health.healthPct)}%` : "—"}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  "h-full rounded-full",
                  !health ? "bg-white/20" : health.healthPct < 50 ? "bg-status-crit" : health.healthPct < 70 ? "bg-status-warn" : "bg-status-ok",
                )}
                style={{ width: `${health ? Math.max(4, health.healthPct) : 0}%` }}
              />
            </div>
            {health ? <p className="mt-1 text-[10px] text-zinc-500">Service {health.dueLabel.toLowerCase()}</p> : null}
          </div>
        ) : null}

        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Open issues</p>
          {issues.length ? (
            <ul className="space-y-1">
              {issues.map((i) => (
                <li key={i.id} className="flex gap-2 rounded-lg bg-white/4 px-2 py-1.5 text-[11px]">
                  <AlertTriangle
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      i.severity === "critical" ? "text-status-crit" : i.severity === "warning" ? "text-status-warn" : "text-status-info",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-zinc-100">{i.title}</span>
                    <span className="block truncate text-zinc-500">{i.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11px] text-zinc-500">None open for this assembly.</p>
          )}
        </div>

        <ReportFlow machineId={machineId} shownOn={shownOn} componentId={spec.id} context={context} />
      </div>
    </div>
  );
}

/* ============================================================== report flow */

type Flow =
  | { step: "idle" }
  | { step: "preparing"; tool: ActionTool }
  | { step: "review"; action: PendingAction }
  | { step: "confirming"; action: PendingAction }
  | { step: "done"; record: DraftedRecord }
  | { step: "error"; message: string; offline: boolean };

function ReportFlow({
  machineId,
  shownOn,
  componentId,
  context,
}: {
  machineId: string;
  shownOn: string | null;
  componentId: string;
  context: string;
}) {
  const [flow, setFlow] = useState<Flow>({ step: "idle" });
  const view = { kind: "xray" as const, machine_id: machineId, shown_on: shownOn, component: componentId };

  const start = async (tool: ActionTool) => {
    setFlow({ step: "preparing", tool });
    const args =
      tool === "create_work_order"
        ? { machine_id: machineId, issue: context, component: componentId, view }
        : { machine_id: machineId, summary: context.length >= 5 ? context : `${componentId} on ${machineId}`, component: componentId, view };
    try {
      setFlow({ step: "review", action: await prepareAction(tool, args) });
    } catch (e) {
      setFlow({ step: "error", message: (e as Error).message, offline: e instanceof ActionUnavailable });
    }
  };

  const confirm = async (action: PendingAction) => {
    setFlow({ step: "confirming", action });
    try {
      setFlow({ step: "done", record: await confirmAction(action.action_id) });
    } catch (e) {
      setFlow({ step: "error", message: (e as Error).message, offline: e instanceof ActionUnavailable });
    }
  };

  if (flow.step === "idle" || flow.step === "preparing") {
    const busy = flow.step === "preparing" ? flow.tool : null;
    return (
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => start("create_work_order")}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gradient-cat text-xs font-semibold text-ink-950 disabled:opacity-60"
        >
          {busy === "create_work_order" ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
          Raise work order
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => start("create_incident")}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-white/6 text-xs font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-60"
        >
          {busy === "create_incident" ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
          Log incident
        </button>
      </div>
    );
  }

  if (flow.step === "review" || flow.step === "confirming") {
    const a = flow.action;
    const preview = a.preview as { fault_codes?: string[]; forecast?: { component: string; health_pct?: number }[] };
    return (
      <div className="rounded-lg border border-[#ffb020]/40 bg-[#ffb020]/8 p-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#ffcf6b]">Draft — confirm to file</p>
        <p className="mt-1 text-xs text-zinc-100">{a.summary}</p>
        {preview.fault_codes?.length ? (
          <p className="mt-1 text-[11px] text-zinc-400">Fault codes: {preview.fault_codes.join(", ")}</p>
        ) : null}
        {preview.forecast?.length ? (
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Forecast: {preview.forecast.map((f) => `${f.component} ${f.health_pct ?? "?"}%`).join(" · ")}
          </p>
        ) : null}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setFlow({ step: "idle" })}
            disabled={flow.step === "confirming"}
            className="h-8 rounded-lg border border-white/12 text-xs text-zinc-300 hover:bg-white/8"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={() => confirm(a)}
            disabled={flow.step === "confirming"}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-gradient-cat text-xs font-semibold text-ink-950"
          >
            {flow.step === "confirming" ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Confirm
          </button>
        </div>
      </div>
    );
  }

  if (flow.step === "done") {
    const r = flow.record;
    const draft = (r.draft ?? {}) as { title?: string; priority?: string; description?: string; summary?: string };
    return (
      <div className="rounded-lg border border-status-ok/40 bg-status-ok/8 p-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-status-ok">
          <CheckCircle2 className="size-3.5" /> {r.id} filed
        </p>
        <p className="mt-1 text-xs font-semibold text-zinc-100">{draft.title}</p>
        <p className="mt-0.5 line-clamp-3 text-[11px] text-zinc-400">{draft.description ?? draft.summary}</p>
        <p className="mt-1 text-[10px] text-zinc-500">
          {draft.priority ? `Priority ${draft.priority} · ` : ""}drafted by {r.draft_source}
        </p>
        <a
          href={r.kind === "work_order" ? "/dashboard/maintenance#drafted" : "/dashboard/incidents#drafted"}
          className="mt-1.5 inline-block text-[11px] font-semibold text-[#62d0ff] hover:underline"
        >
          Open in reports →
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-status-crit/40 bg-status-crit/8 p-2.5">
      <p className="text-[11px] font-semibold text-status-crit">
        {flow.offline ? "Copilot backend offline" : "Could not file"}
      </p>
      <p className="mt-0.5 text-[11px] text-zinc-400">
        {flow.offline
          ? "Nothing was filed. Start the backend (cd backend && uv run python -m copilot) and try again."
          : flow.message}
      </p>
      <button type="button" onClick={() => setFlow({ step: "idle" })} className="mt-1.5 text-[11px] font-semibold text-zinc-200 hover:underline">
        Back
      </button>
    </div>
  );
}
