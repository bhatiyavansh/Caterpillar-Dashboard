"""The agent's tools (P2_SPEC §5.4). Facts come from the hub's World, Person C's simulator API or
C's `intelligence` package via the ML port; every result carries provenance."""

from __future__ import annotations

import json
import time
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from copilot.agent.registry import ALL, Tool, ToolContext, ToolError, ToolRegistry, ToolResult
from copilot.config import BACKEND_DIR, REPO_DIR
from copilot.ml.port import MLUnavailable
from copilot.sim_client import SimError, SimUnavailable
from simulator.config import FLEET, OPERATORS

FLEET_BY_ID = {f.machine_id: f for f in FLEET}
OPERATOR_BY_ID = {o.operator_id: o for o in OPERATORS}
TRAINING_MODULES = ("Pre-start inspection", "Trenching technique", "Slope and bench safety",
                    "Fuel-efficient operation", "Working near ground crew", "Load handling")
MachineId = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}\d{3}$"), Field(description="Machine id, e.g. EXC001")]
OperatorId = Annotated[str, StringConstraints(pattern=r"^OP\d{4}$"), Field(description="Operator id, e.g. OP1001")]


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- helpers


def _machine(ctx: ToolContext, machine_id: str) -> dict[str, Any]:
    m = ctx.hub.world.machines.get(machine_id)
    if m is None:
        known = ", ".join(sorted(ctx.hub.world.machines)) or "none (no live data source)"
        raise ToolError(f"unknown machine {machine_id}; live machines: {known}", "hub")
    return m


def _source_prov(ctx: ToolContext) -> str:
    src = ctx.hub.active_source()
    return f"live:{src.kind}" if src else "live:none"


def _operator_for(ctx: ToolContext, machine_id: str | None) -> str | None:
    if machine_id is None:
        return None
    live = ctx.hub.world.machines.get(machine_id, {}).get("operator_id")
    return live or (FLEET_BY_ID[machine_id].operator_id if machine_id in FLEET_BY_ID else None)


async def _tasks(ctx: ToolContext, operator_id: str | None = None) -> tuple[list[dict[str, Any]], str]:
    try:
        return await ctx.sim.tasks(operator_id), "simulator"
    except (SimUnavailable, SimError) as exc:
        fixture = json.loads((REPO_DIR / "fixtures" / "tasks.json").read_text())
        if operator_id:
            fixture = [t for t in fixture if t["operator_id"] == operator_id]
        return fixture, f"fixture (simulator unavailable: {exc.__class__.__name__})"


def _slim(m: dict[str, Any]) -> dict[str, Any]:
    keys = ("machine_id", "model", "machine_type", "operator_id", "status", "zone", "intent", "speed_mps",
            "fuel_level_pct", "idle_min", "load_cycles", "seatbelt", "bubble", "nearest_person_m",
            "hydraulic_temp_c", "tip_over_margin", "fault_codes", "task_id", "task_progress", "task_eta_min", "ts")
    return {k: m[k] for k in keys if k in m}


# --------------------------------------------------------------------------- read tools


class MachineIn(_In):
    machine_id: MachineId


async def get_machine_status(ctx: ToolContext, a: MachineIn) -> ToolResult:
    m = _machine(ctx, a.machine_id)
    alerts = [
        {"event": e["event"], "severity": e["severity"], "message": e.get("message"), "ts": e.get("ts")}
        for e in ctx.hub.world.active_alerts() if e.get("machine_id") == a.machine_id
    ]
    return ToolResult(True, {"machine": m, "active_alerts": alerts}, _source_prov(ctx),
                      f"{a.machine_id} status")


class EmptyIn(_In):
    pass


async def get_fleet_overview(ctx: ToolContext, a: EmptyIn) -> ToolResult:
    world = ctx.hub.world
    machines = [_slim(world.machines[k]) for k in sorted(world.machines)]
    recent = [e for e in list(ctx.hub.ring)[-30:] if e.get("type") == "event"]
    kpis = await ctx.ml.fleet_kpis({"machines": list(world.machines.values()),
                                    "environment": dict(world.environment), "recent_events": recent})
    return ToolResult(True, {"machines": machines, "active_alerts": world.active_alerts(),
                             "environment": dict(world.environment), "kpis": kpis},
                      f"{_source_prov(ctx)} + kpis:{kpis.get('provenance')}", f"{len(machines)} machines")


class ShiftTasksIn(_In):
    operator_id: OperatorId | None = None
    machine_id: MachineId | None = None


async def get_shift_tasks(ctx: ToolContext, a: ShiftTasksIn) -> ToolResult:
    op = a.operator_id or _operator_for(ctx, a.machine_id or ctx.machine_id) or ctx.operator_id
    if op is None:
        raise ToolError("need an operator_id or machine_id")
    tasks, prov = await _tasks(ctx, op)
    return ToolResult(True, {"operator_id": op, "tasks": tasks}, prov, f"{len(tasks)} tasks for {op}")


async def get_site_plan(ctx: ToolContext, a: EmptyIn) -> ToolResult:
    """The whole site's plan for the shift: every operator's task queue, what each machine is doing now."""
    tasks, prov = await _tasks(ctx)
    by_op: dict[str, list[dict[str, Any]]] = {}
    for t in sorted(tasks, key=lambda t: (t["operator_id"], t.get("order", 0))):
        by_op.setdefault(t["operator_id"], []).append(t)
    crews = []
    for op, ts in by_op.items():
        cur = next((t for t in ts if t["status"] == "in_progress"), None)
        crews.append({"operator_id": op, "machine_id": ts[0].get("machine_id"),
                      "current": {k: cur.get(k) for k in ("task_id", "task_type", "zone", "progress", "eta_min")}
                      if cur else None,
                      "queue": [f"{t['task_id']} {t['task_type']} zone {t['zone']} ({t['status']})" for t in ts]})
    counts: dict[str, int] = {}
    for t in tasks:
        counts[t["status"]] = counts.get(t["status"], 0) + 1
    whatifs = [{k: j.get(k) for k in ("job_id", "status", "params", "started_at")}
               for j in list(getattr(ctx.jobs, "jobs", {}).values())[-3:]]
    return ToolResult(True, {"tasks_total": len(tasks), "by_status": counts, "crews": crews,
                             "what_if_runs": whatifs}, prov,
                      f"{len(tasks)} tasks across {len(crews)} operators")


class RecentEventsIn(_In):
    machine_id: MachineId | None = None
    types: list[str] | None = None
    minutes: int = Field(30, ge=1, le=24 * 60)


async def get_recent_events(ctx: ToolContext, a: RecentEventsIn) -> ToolResult:
    cutoff = time.time() - a.minutes * 60
    from copilot.timeutil import parse_ts

    out, noise = [], 0
    for e in reversed(ctx.hub.ring):
        if e.get("type") != "event":
            continue
        ts = parse_ts(e.get("ts")) or 0
        if ts < cutoff:
            break
        if a.machine_id and e.get("machine_id") != a.machine_id:
            continue
        if a.types and e.get("event") not in a.types:
            continue
        data = e.get("data") or {}
        if e.get("event") == "anomaly_detected" and data.get("anomaly_type") == "unusual_pattern" \
                and data.get("window_min") == 1:
            noise += 1  # REPO_ANALYSIS C12: forest applied to 60 s windows misfires
            continue
        out.append({k: e.get(k) for k in ("id", "ts", "event", "severity", "machine_id", "source", "message", "data")})
        if len(out) >= 50:
            break
    return ToolResult(True, {"events": out, "suppressed_live_unusual_pattern": noise}, "hub",
                      f"{len(out)} events in {a.minutes} min")


class TaskIn(_In):
    task_id: str = Field(pattern=r"^T-\d{4}$", description="Task id, e.g. T-0001")


async def predict_task_time(ctx: ToolContext, a: TaskIn) -> ToolResult:
    tasks, prov = await _tasks(ctx)
    task = next((t for t in tasks if t["task_id"] == a.task_id), None)
    if task is None:
        raise ToolError(f"unknown task {a.task_id}", prov)
    feats: dict[str, Any] = {"task_type": task["task_type"], "volume_m3": task["volume_m3"], "soil": task["soil"],
                             "estimated_time_min": task["estimate"]["p50"]}
    defaulted: list[str] = []
    fleet = FLEET_BY_ID.get(task["machine_id"])
    if fleet:
        feats["machine_model"] = fleet.model
    op = OPERATOR_BY_ID.get(task["operator_id"])
    if op:
        feats["operator_skill"], feats["operator_years"] = op.skill, op.years_experience
    env = ctx.hub.world.environment
    for k in ("weather", "visibility_m"):
        if k in env:
            feats[k] = env[k]
    for k in ("weather", "visibility_m", "temperature_c", "site_congestion", "time_of_day", "machine_health"):
        if k not in feats:
            defaulted.append(k)
    try:
        est = await ctx.ml.estimate_task(feats)
    except MLUnavailable as exc:
        raise ToolError(str(exc), "ml") from exc
    progress = float(task.get("progress") or 0.0)
    remaining = {q: round(est[q] * (1 - progress), 1) for q in ("p10", "p50", "p90")}
    return ToolResult(True, {"task": task, "estimate_total_min": {q: est[q] for q in ("p10", "p50", "p90")},
                             "remaining_min": remaining, "progress": progress, "reasons": est.get("reasons", []),
                             "features_used": feats, "features_defaulted": defaulted, "note": est.get("note")},
                      f"{est['provenance']} (tasks: {prov})", f"{a.task_id}: p50 {est['p50']} min")


class AnomaliesIn(_In):
    machine_id: MachineId | None = None
    since_hours: int = Field(24, ge=1, le=24 * 30)


async def get_anomalies(ctx: ToolContext, a: AnomaliesIn) -> ToolResult:
    res = await ctx.ml.anomalies(a.machine_id, a.since_hours, live=list(ctx.hub.world.machines.values()))
    rows = res["anomalies"][:10]
    return ToolResult(True, {"anomalies": rows, "total": len(res["anomalies"]), "note": res.get("note")},
                      res["provenance"], f"{len(res['anomalies'])} anomalies")


class MaintenanceIn(_In):
    machine_id: MachineId | None = None


async def get_maintenance_forecast(ctx: ToolContext, a: MaintenanceIn) -> ToolResult:
    try:
        res = await ctx.ml.maintenance(a.machine_id)
    except MLUnavailable as exc:
        raise ToolError(str(exc), "ml") from exc
    rows = res["forecast"][:9]
    return ToolResult(True, {"forecast": rows, "total": len(res["forecast"])}, res["provenance"],
                      f"{len(res['forecast'])} forecasts")


class WhatIfIn(_In):
    trucks: int | None = Field(None, ge=1, le=8)
    weather: Literal["clear", "rain", "fog", "heat", "wind"] | None = None
    shift_hours: float | None = Field(None, ge=1, le=12)
    road_closed: bool | None = None
    add_spotter: bool | None = None


async def run_what_if(ctx: ToolContext, a: WhatIfIn) -> ToolResult:
    params = a.model_dump(exclude_none=True)
    job = await ctx.jobs.submit(params)
    if job["status"] == "running":
        job = await ctx.jobs.wait(job["job_id"], 2.5)
    if job["status"] == "done":
        return ToolResult(True, {"params": params, "result": job["result"], "cached": job.get("cached", False)},
                          job["result"].get("provenance", "headless_sim"), "what-if done")
    if job["status"] == "failed":
        raise ToolError(f"what-if failed: {job['error']}", "ml")
    return ToolResult(True, {"params": params, "status": "running", "job_id": job["job_id"],
                             "note": "Takes ~40 s. Results appear on GET /api/whatif/{job_id}; ask again shortly."},
                      "headless_sim (pending)", "what-if running")


class ManualIn(_In):
    query: str = Field(min_length=2, max_length=300)


async def search_manual(ctx: ToolContext, a: ManualIn) -> ToolResult:
    rag = ctx.extras.get("rag")
    if rag is None:
        raise ToolError("the manual index is not built yet (Phase C)", "stub")
    return await rag.tool_search(a.query)


class ProtocolIn(_In):
    event: str | None = Field(None, description="Event kind, e.g. proximity_alert")
    protocol_id: str | None = Field(None, description="Protocol id, e.g. PRT-PROXIMITY")
    component: str | None = Field(None, description="For maintenance_due: the component, e.g. hydraulic_pump")


def _protocol_list(lib: Any) -> list[dict[str, Any]]:
    return [{"protocol_id": p.id, "title": p.title, "for_events": list(p.applies_to_events),
             "regulation": (p.regulation or {}).get("citation") if isinstance(p.regulation, dict) else None}
            for p in lib.protocols]


async def list_documents(ctx: ToolContext, a: EmptyIn) -> ToolResult:
    """Every document the assistant can read: site protocols (SOPs) and manuals/regulations."""
    lib, rag = ctx.extras.get("protocols"), ctx.extras.get("rag")
    if lib is None and rag is None:
        raise ToolError("document library not loaded", "stub")
    docs: dict[str, dict[str, Any]] = {}
    for c in (rag.chunks if rag is not None else []):
        d = docs.setdefault(c.doc_id, {"doc_id": c.doc_id, "title": c.title, "citation": c.citation.split("(")[0].strip(),
                                       "source": c.source, "sections": 0})
        d["sections"] += 1
    return ToolResult(True, {"protocols": _protocol_list(lib) if lib is not None else [],
                             "manuals": list(docs.values()),
                             "note": "Use get_protocol for a protocol's steps and search_manual to read a manual."},
                      "document_library", f"{len(lib.protocols) if lib else 0} protocols, {len(docs)} manuals")


async def get_protocol(ctx: ToolContext, a: ProtocolIn) -> ToolResult:
    lib = ctx.extras.get("protocols")
    if lib is None:
        raise ToolError("protocol library not loaded", "stub")
    if a.protocol_id:
        p = lib.by_id.get(a.protocol_id)
    elif a.event:
        p = lib.for_event({"event": a.event, "data": {"component": a.component} if a.component else {}})
    else:
        return ToolResult(True, {"found": False, "protocols": _protocol_list(lib)}, "protocol_library",
                          f"{len(lib.protocols)} protocols on file")
    if p is None:
        return ToolResult(True, {"found": False, "available": sorted(lib.by_id)}, "protocol_library",
                          "no protocol for that")
    return ToolResult(True, {"found": True, "protocol": p.ref(),
                             "note": "Quote the steps exactly as written; do not paraphrase or add steps."},
                      "protocol_library", f"protocol {p.id}")


# --------------------------------------------------------------------------- confirm tools


class ReorderIn(_In):
    operator_id: OperatorId
    reason: str = Field(min_length=2, max_length=120, description="Why, e.g. 'rain'")


async def reorder_prepare(ctx: ToolContext, a: ReorderIn) -> tuple[str, dict[str, Any]]:
    tasks, prov = await _tasks(ctx, a.operator_id)
    order = [t["task_id"] for t in sorted(tasks, key=lambda t: t.get("order", 0))]
    return (f"Re-sequence {a.operator_id}'s tasks for: {a.reason}",
            {"current_order": order, "source": prov, "rule": "simulator reorder rule (rain/wet reasons first run "
             "in-progress tasks, then weather-sensitive types last)"})


async def reorder_execute(ctx: ToolContext, a: ReorderIn) -> ToolResult:
    try:
        res = await ctx.sim.reorder_tasks(a.operator_id, a.reason)
    except (SimUnavailable, SimError) as exc:
        raise ToolError(f"simulator could not reorder: {exc}", "simulator") from exc
    return ToolResult(True, res, "simulator", f"reordered {a.operator_id}")


class IncidentIn(_In):
    machine_id: MachineId
    summary: str = Field(min_length=5, max_length=600, description="What happened, in the user's words")
    event_id: str | None = Field(None, description="Hub event id the incident is about, if any")


def _incident_facts(ctx: ToolContext, a: IncidentIn) -> dict[str, Any]:
    m = ctx.hub.world.machines.get(a.machine_id)
    events = [e for e in ctx.hub.ring if e.get("type") == "event" and e.get("machine_id") == a.machine_id][-10:]
    ref = next((e for e in ctx.hub.ring if a.event_id and e.get("id") == a.event_id), None)
    return {"machine_state": _slim(m) if m else None,
            "trigger_event": ref,
            "recent_events": [{k: e.get(k) for k in ("id", "ts", "event", "severity", "message", "data")} for e in events],
            "environment": dict(ctx.hub.world.environment), "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


async def incident_prepare(ctx: ToolContext, a: IncidentIn) -> tuple[str, dict[str, Any]]:
    _machine(ctx, a.machine_id)
    return f"File an incident report for {a.machine_id}", {"facts": _incident_facts(ctx, a)}


async def incident_execute(ctx: ToolContext, a: IncidentIn) -> ToolResult:
    reports = ctx.extras.get("reports")
    if reports is not None:  # Phase C: structured, validated draft
        rec = await reports.file_incident(ctx, a, _incident_facts(ctx, a))
    else:
        rec = await ctx.records.create("incident", {
            "machine_id": a.machine_id, "operator_id": _operator_for(ctx, a.machine_id),
            "narrative": a.summary, "narrative_source": "user/assistant, confirmed by operator",
            "facts": _incident_facts(ctx, a), "event_id": a.event_id}, status="confirmed")
    ctx.hub.hub_event("incident_created", "medium", f"Incident {rec['id']} filed for {a.machine_id}",
                      {"incident_id": rec["id"]}, machine_id=a.machine_id)
    return ToolResult(True, {"incident_id": rec["id"], "record": rec}, "records", f"incident {rec['id']}")


class WorkOrderIn(_In):
    machine_id: MachineId
    issue: str = Field(min_length=3, max_length=400)


async def wo_prepare(ctx: ToolContext, a: WorkOrderIn) -> tuple[str, dict[str, Any]]:
    m = _machine(ctx, a.machine_id)
    try:
        forecast = (await ctx.ml.maintenance(a.machine_id))["forecast"]
    except MLUnavailable:
        forecast = []
    return (f"Raise a work order for {a.machine_id}: {a.issue}",
            {"fault_codes": m.get("fault_codes", []), "forecast": forecast[:3]})


async def wo_execute(ctx: ToolContext, a: WorkOrderIn) -> ToolResult:
    _, preview = await wo_prepare(ctx, a)
    reports = ctx.extras.get("reports")
    if reports is not None:
        rec = await reports.create_work_order(ctx, a, preview)
    else:
        rec = await ctx.records.create("work_order", {"machine_id": a.machine_id, "issue": a.issue, **preview},
                                       status="draft")
    ctx.hub.hub_event("work_order_created", "info", f"Work order {rec['id']} drafted for {a.machine_id}",
                      {"work_order_id": rec["id"]}, machine_id=a.machine_id)
    return ToolResult(True, {"work_order_id": rec["id"], "record": rec}, "records", f"work order {rec['id']}")


class TrainingIn(_In):
    operator_id: OperatorId
    module: Literal[TRAINING_MODULES]  # type: ignore[valid-type]


def _slots() -> list[dict[str, Any]]:
    return json.loads((BACKEND_DIR / "data" / "training_slots.json").read_text())["slots"]


async def _free_slot(ctx: ToolContext, module: str) -> dict[str, Any] | None:
    booked = await ctx.records.list("booking", limit=1000)
    for s in _slots():
        if s["module"] == module and sum(1 for b in booked if b.get("slot_id") == s["slot_id"]) < s["capacity"]:
            return s
    return None


async def training_prepare(ctx: ToolContext, a: TrainingIn) -> tuple[str, dict[str, Any]]:
    slot = await _free_slot(ctx, a.module)
    if slot is None:
        raise ToolError(f"no free slot for '{a.module}' in the demo calendar", "demo_seed")
    return (f"Book {a.operator_id} on '{a.module}' ({slot['date']} {slot['start']}, {slot['trainer']})",
            {"slot": slot, "calendar": "demo_seed"})


async def training_execute(ctx: ToolContext, a: TrainingIn) -> ToolResult:
    slot = await _free_slot(ctx, a.module)
    if slot is None:
        raise ToolError(f"slot for '{a.module}' filled up before confirmation", "demo_seed")
    rec = await ctx.records.create("booking", {"operator_id": a.operator_id, "module": a.module, **slot},
                                   status="booked")
    ctx.hub.hub_event("training_booked", "info", f"{a.operator_id} booked on {a.module} ({slot['date']})",
                      {"booking_id": rec["id"], "slot_id": slot["slot_id"]})
    return ToolResult(True, {"booking_id": rec["id"], "record": rec}, "records (demo calendar)",
                      f"booking {rec['id']}")


# --------------------------------------------------------------------------- registry

CAB_CMD = frozenset({"cab", "command"})


def build_tools() -> list[Tool]:
    return [
        Tool("get_machine_status", "Live state and active alerts of one machine (position, fuel, seatbelt, "
             "bubble, temperatures, task progress).", MachineIn, get_machine_status, ALL,
             frozenset({"safety", "maintenance", "coordination", "general", "planner"})),
        Tool("get_fleet_overview", "All live machines, active alerts, site environment and fleet KPIs.",
             EmptyIn, get_fleet_overview, frozenset({"command", "owner", "training"}),
             frozenset({"planner", "reporting", "coordination", "general"})),
        Tool("get_shift_tasks", "Today's tasks for an operator (or the operator of a machine), in order, with "
             "progress and planner estimates.", ShiftTasksIn, get_shift_tasks,
             frozenset({"cab", "command", "training"}), frozenset({"planner", "general", "coordination"})),
        Tool("get_site_plan", "The whole site's plan for this shift: every operator's task queue in order, what "
             "each machine is working on now, task counts by status.", EmptyIn, get_site_plan, ALL,
             frozenset({"planner", "general", "coordination", "reporting"})),
        Tool("reorder_tasks", "Re-sequence an operator's tasks for a reason such as rain. Needs confirmation.",
             ReorderIn, reorder_execute, CAB_CMD, frozenset({"planner", "general"}), True, reorder_prepare),
        Tool("predict_task_time", "ML time estimate (P10/P50/P90 minutes, remaining time, reasons) for a task.",
             TaskIn, predict_task_time, frozenset({"cab", "command", "owner"}), frozenset({"planner", "general"})),
        Tool("get_anomalies", "Unusual machine usage (idling, seatbelt violations, overload...) with fuel cost.",
             AnomaliesIn, get_anomalies, frozenset({"cab", "command", "owner"}),
             frozenset({"maintenance", "reporting", "general", "safety"}), timeout_s=5.0),
        Tool("get_maintenance_forecast", "Component health and hours until service, per machine.",
             MaintenanceIn, get_maintenance_forecast, frozenset({"cab", "command", "owner", "ar"}),
             frozenset({"maintenance", "reporting", "general"})),
        Tool("get_recent_events", "Recent site events (safety alerts, advisories, anomalies) from the live "
             "stream, optionally filtered.", RecentEventsIn, get_recent_events, ALL,
             frozenset({"safety", "maintenance", "reporting", "coordination", "general", "training"})),
        Tool("search_manual", "Search the machine manuals and fault codes; returns passages with page citations.",
             ManualIn, search_manual, ALL, frozenset({"maintenance", "safety", "training", "general"})),
        Tool("get_protocol", "The site protocol for a safety event or protocol id: steps to follow (verbatim), "
             "escalation, and the regulation it cites.", ProtocolIn, get_protocol, ALL,
             frozenset({"safety", "training", "general", "maintenance"})),
        Tool("list_documents", "List every document on file: the site's safety protocols (SOPs) and the "
             "manuals/regulations. Use when asked what protocols, procedures, manuals or rules exist.", EmptyIn,
             list_documents, ALL, frozenset({"safety", "maintenance", "training", "general", "reporting",
                                              "planner", "coordination"})),
        Tool("create_incident", "File an incident report for a machine. Needs confirmation.", IncidentIn,
             incident_execute, CAB_CMD, frozenset({"safety", "reporting", "general"}), True, incident_prepare,
             timeout_s=10.0),
        Tool("create_work_order", "Draft a maintenance work order for a machine. Needs confirmation.",
             WorkOrderIn, wo_execute, frozenset({"cab", "command", "owner", "ar"}),
             frozenset({"maintenance", "general"}), True, wo_prepare, timeout_s=10.0),
        Tool("book_training", "Book an operator on a training module (demo calendar). Needs confirmation.",
             TrainingIn, training_execute, frozenset({"training", "command", "cab"}),
             frozenset({"training", "general"}), True, training_prepare),
        Tool("run_what_if", "Re-simulate the shift with changed trucks/weather/shift length/road closure/"
             "spotter and compare with the current plan (~40 s; may return a job id).", WhatIfIn, run_what_if,
             frozenset({"command", "owner"}), frozenset({"planner", "reporting", "coordination", "general"})),
    ]


def build_registry() -> ToolRegistry:
    from copilot.agent.tools.vision import build_vision_tools

    return ToolRegistry(build_tools() + build_vision_tools())
