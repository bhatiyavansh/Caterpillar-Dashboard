"""Deterministic answers built only from tool results - used when the LLM is down/slow or its answer
fails grounding twice. Templates never add facts; they only format what the tools returned."""

from __future__ import annotations

from typing import Any

from copilot.agent.registry import ToolResult


def _fmt(v: Any) -> str:
    return f"{v:g}" if isinstance(v, float) else str(v)


def summarize(name: str, r: ToolResult) -> str:
    if not r.ok:
        return f"{name}: unavailable ({r.data.get('error') if isinstance(r.data, dict) else r.summary})."
    d = r.data if isinstance(r.data, dict) else {}
    if name == "get_machine_status":
        m = d.get("machine", {})
        parts = [f"{m.get('machine_id')} is {m.get('status', 'reporting')}"]
        for key, label, unit in (("zone", "zone", ""), ("fuel_level_pct", "fuel", "%"),
                                 ("seatbelt", "seatbelt", ""), ("hydraulic_temp_c", "hydraulic oil", " °C"),
                                 ("tip_over_margin", "tip-over margin", "")):
            if key in m:
                parts.append(f"{label} {_fmt(m[key])}{unit}")
        alerts = d.get("active_alerts") or []
        text = ", ".join(parts) + "."
        if alerts:
            text += " Active: " + "; ".join(f"{a['event']} ({a['severity']})" for a in alerts) + "."
        return text
    if name == "get_shift_tasks":
        tasks = d.get("tasks", [])
        return f"{d.get('operator_id')} has {len(tasks)} tasks: " + "; ".join(
            f"{t['task_id']} {t['task_type']} in zone {t['zone']} ({t['status']}, {round(t['progress'] * 100)}%)"
            for t in tasks) + "."
    if name == "predict_task_time":
        e = d.get("remaining_min", {})
        return (f"{d['task']['task_id']}: about {_fmt(e.get('p50'))} min remaining "
                f"(range {_fmt(e.get('p10'))}-{_fmt(e.get('p90'))} min; source {r.provenance}).")
    if name == "get_recent_events":
        ev = d.get("events", [])[:5]
        if not ev:
            return "No recent events in that window."
        return "Recent: " + "; ".join(f"{e['event']} on {e.get('machine_id') or 'site'} ({e['severity']})" for e in ev) + "."
    if name == "get_fleet_overview":
        ms = d.get("machines", [])
        return f"{len(ms)} machines live; {len(d.get('active_alerts', []))} active alerts."
    if name == "get_anomalies":
        rows = d.get("anomalies", [])[:3]
        if not rows:
            return "No anomalies found."
        return "Anomalies: " + "; ".join(f"{a['machine_id']} {a['type']}" for a in rows) + f" (source {r.provenance})."
    if name == "get_maintenance_forecast":
        rows = d.get("forecast", [])[:3]
        return "Service outlook: " + "; ".join(
            f"{f['machine_id']} {f['component']} in {f['hours_to_service']} h" for f in rows) + "."
    if r.pending_action:
        return f"{r.pending_action['summary']}. Say or tap confirm to go ahead."
    return f"{name}: {r.summary}."


def deterministic_answer(results: list[tuple[str, ToolResult]], reason: str) -> str:
    if not results:
        return ("I can't reach the assistant model right now, so I can only answer from live data. "
                "Try asking about a specific machine, e.g. 'status of EXC001'.")
    return " ".join(summarize(n, r) for n, r in results)
