"use client";

/**
 * The incident log.
 *
 * The problem this solves is not storage, it is that near misses go unrecorded.
 * Nobody stops work to fill in a form, so the log writes itself the moment a
 * safety alert goes critical, capturing what a review will ask for and what
 * nobody remembers an hour later: who was in the seat, where the machine was,
 * and what the weather was doing.
 *
 * What is left for a person is the part only a person can do — reading it and
 * deciding. So an automatic entry lands as a draft, and a supervisor files it
 * with a note.
 */
import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CircleAlert,
  ClipboardCheck,
  Cloud,
  CloudRain,
  MapPin,
  Plus,
  Sun,
  Thermometer,
  User,
} from "lucide-react";
import type { Incident, WeatherMode } from "@/lib/api/contracts";
import type { ReportedIncident } from "@/lib/hooks/use-site";
import { Button, EmptyState, Input, Select } from "@/components/ui/primitives";
import { SeverityChip } from "@/components/ui/status";
import type { IconComponent } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<Incident["kind"], string> = {
  proximity: "Proximity",
  collision: "Machine conflict",
  seatbelt: "Seatbelt",
  tip_over: "Stability",
  fatigue: "Fatigue",
  hydraulic: "Hydraulic",
  fuel: "Fuel",
  weather: "Weather",
  anomaly: "Unusual usage",
  maintenance: "Maintenance",
};

const WEATHER_ICON: Record<WeatherMode, IconComponent> = {
  clear: Sun,
  rain: CloudRain,
  fog: Cloud,
  heat: Thermometer,
};

const STATUS: Record<Incident["status"], { label: string; chip: string }> = {
  draft: { label: "Needs review", chip: "bg-status-warn/15 text-status-warn" },
  filed: { label: "Filed", chip: "bg-status-info/15 text-status-info" },
  reviewed: { label: "Reviewed", chip: "bg-status-ok/15 text-status-ok" },
};

function when(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

function IncidentRow({
  incident,
  onFile,
}: {
  incident: Incident;
  onFile: (id: string, status: Incident["status"], note?: string) => void;
}) {
  const [note, setNote] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const status = STATUS[incident.status];
  const WeatherIcon = WEATHER_ICON[incident.weather] ?? Sun;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className={cn(
        "panel-raised p-4",
        incident.status === "draft" && "border-status-warn/40",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-50">{incident.title}</h3>
            <SeverityChip severity={incident.severity} size="sm" soundKey={incident.id} />
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                status.chip,
              )}
            >
              {status.label}
            </span>
            {incident.automatic ? (
              <span className="rounded border border-white/12 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
                Logged automatically
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted">
            {incident.id} · {incident.machineId} · {KIND_LABEL[incident.kind]} ·{" "}
            {when(incident.at)}
          </p>
        </div>
        {incident.replayable ? (
          <span className="rounded border border-cat-500/40 bg-cat-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-cat-500">
            Replay stored
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-zinc-300">{incident.summary}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/8 pt-2.5 text-[11px] text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <User className="size-3.5 text-zinc-500" aria-hidden />
          {incident.operatorName ?? "Unassigned"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5 text-zinc-500" aria-hidden />
          {incident.zone}
          {incident.position
            ? ` · ${incident.position.x.toFixed(0)}, ${incident.position.z.toFixed(0)} m`
            : ""}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <WeatherIcon className="size-3.5 text-zinc-500" aria-hidden />
          {incident.weather}
        </span>
      </div>

      {incident.note ? (
        <p className="mt-2 rounded border border-white/8 bg-ink-900 px-2.5 py-2 text-[11px] text-zinc-300">
          <span className="font-semibold uppercase tracking-wider text-zinc-500">Note </span>
          {incident.note}
        </p>
      ) : null}

      {incident.status !== "reviewed" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {open ? (
            <>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What was done about it?"
                aria-label={`Note for ${incident.id}`}
                className="min-w-48 flex-1"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onFile(incident.id, incident.status === "draft" ? "filed" : "reviewed", note);
                  setOpen(false);
                  setNote("");
                }}
              >
                <ClipboardCheck className="size-3.5" aria-hidden />
                {incident.status === "draft" ? "File" : "Mark reviewed"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <ClipboardCheck className="size-3.5" aria-hidden />
              {incident.status === "draft" ? "File with a note" : "Mark reviewed"}
            </Button>
          )}
        </div>
      ) : null}
    </motion.article>
  );
}

/** Logging something a rule could not have seen — a person reporting it. */
function ReportForm({
  machineIds,
  onReport,
}: {
  machineIds: string[];
  onReport: (input: ReportedIncident) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [machineId, setMachineId] = React.useState(machineIds[0] ?? "EXC001");
  const [kind, setKind] = React.useState<Incident["kind"]>("proximity");
  const [severity, setSeverity] = React.useState<Incident["severity"]>("warning");
  const [title, setTitle] = React.useState("");
  const [summary, setSummary] = React.useState("");

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        Report an incident
      </Button>
    );
  }

  return (
    <form
      className="panel-raised w-full space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        onReport({ machineId, kind, severity, title: title.trim(), summary: summary.trim() });
        setTitle("");
        setSummary("");
        setOpen(false);
      }}
    >
      <h3 className="text-sm font-semibold text-zinc-100">Report an incident</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="label-xs">Machine</span>
          <Select value={machineId} onChange={(e) => setMachineId(e.target.value)} className="mt-1">
            {machineIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="label-xs">Type</span>
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as Incident["kind"])}
            className="mt-1"
          >
            {(["proximity", "collision", "seatbelt", "tip_over", "fatigue"] as const).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="label-xs">Severity</span>
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Incident["severity"])}
            className="mt-1"
          >
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </Select>
        </label>
      </div>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What happened, in a few words"
        aria-label="Incident title"
        required
      />
      <Input
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Anything a reviewer should know"
        aria-label="Incident summary"
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm">
          Log it
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function IncidentLog({
  incidents,
  machineIds,
  onFile,
  onReport,
}: {
  incidents: Incident[];
  machineIds: string[];
  onFile: (id: string, status: Incident["status"], note?: string) => void;
  onReport: (input: ReportedIncident) => void;
}) {
  const [filter, setFilter] = React.useState<"open" | "all" | Incident["kind"]>("open");
  const [limit, setLimit] = React.useState(20);

  const open = incidents.filter((i) => i.status !== "reviewed");
  const shown =
    filter === "open" ? open : filter === "all" ? incidents : incidents.filter((i) => i.kind === filter);

  const kinds = React.useMemo(() => {
    const counts = new Map<Incident["kind"], number>();
    for (const i of incidents) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [incidents]);

  return (
    <div className="space-y-5">
      <section className="panel-raised p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Incident log</h2>
            <p className="mt-0.5 max-w-xl text-[11px] text-muted">
              Every critical safety alert writes itself here the moment it fires, with the operator,
              the position and the conditions attached. {open.length} still need a supervisor.
            </p>
          </div>
          <ReportForm machineIds={machineIds} onReport={onReport} />
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Logged", value: incidents.length },
            { label: "Awaiting review", value: open.length },
            { label: "Automatic", value: incidents.filter((i) => i.automatic).length },
            { label: "With replay", value: incidents.filter((i) => i.replayable).length },
          ].map((tile) => (
            <div key={tile.label} className="rounded border border-white/8 bg-ink-850 p-3">
              <dt className="label-xs">{tile.label}</dt>
              <dd className="mt-1 font-mono text-lg font-bold tabular-nums text-zinc-50">
                {tile.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["open", `Needs review ${open.length}`],
            ["all", `All ${incidents.length}`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={cn(
              "rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors",
              filter === key
                ? "border-cat-500 bg-cat-500/12 text-cat-500"
                : "border-white/12 text-muted hover:text-zinc-200",
            )}
          >
            {label}
          </button>
        ))}
        {kinds.map(([kind, count]) => (
          <button
            key={kind}
            type="button"
            onClick={() => setFilter(kind)}
            aria-pressed={filter === kind}
            className={cn(
              "rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors",
              filter === kind
                ? "border-cat-500 bg-cat-500/12 text-cat-500"
                : "border-white/12 text-muted hover:text-zinc-200",
            )}
          >
            {KIND_LABEL[kind]} {count}
          </button>
        ))}
      </div>

      {shown.length ? (
        <>
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {shown.slice(0, limit).map((incident) => (
                <IncidentRow key={incident.id} incident={incident} onFile={onFile} />
              ))}
            </AnimatePresence>
          </div>
          {shown.length > limit ? (
            <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + 20)}>
              Show 20 more ({shown.length - limit} left)
            </Button>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={<CircleAlert className="size-6 text-status-ok" aria-hidden />}
          title="Nothing to review"
          body="No incident matches this filter."
        />
      )}
    </div>
  );
}
