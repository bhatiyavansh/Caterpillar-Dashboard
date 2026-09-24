"""Reports (P2_SPEC §7): incidents, work orders, weekly owner report, anomaly explanations.

Pattern for every drafted document:
  facts (deterministic, from the DB/ring/ML)  ->  fast LLM writes a *structured* draft via a tool
  ->  schema + grounding validation  ->  one retry with the problems listed  ->  template fallback.
The template never speculates: it only restates facts. `draft_source` records which path produced it.
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from copilot.agent import grounding
from copilot.agent.llm import LLMError
from copilot.ml.port import MLUnavailable
from copilot.timeutil import now_iso_s, parse_ts


class _Draft(BaseModel):
    model_config = ConfigDict(extra="forbid")


class IncidentDraft(_Draft):
    title: str = Field(max_length=120)
    summary: str = Field(max_length=800)
    timeline: list[str] = Field(default_factory=list, max_length=8)
    contributing_factors: list[str] = Field(default_factory=list, max_length=5)
    recommendations: list[str] = Field(default_factory=list, max_length=5)


class WorkOrderDraft(_Draft):
    title: str = Field(max_length=120)
    description: str = Field(max_length=800)
    priority: str = Field(pattern="^(low|medium|high)$")
    suggested_parts: list[str] = Field(default_factory=list, max_length=6)
    checks: list[str] = Field(default_factory=list, max_length=6)


class Prose(_Draft):
    text: str = Field(max_length=1200)


RULES = ("Use only facts from the JSON you are given. Every number, time and ID you write must appear in it. "
         "Do not speculate about causes the data does not show. Call the submit_draft tool exactly once.")


def _texts(draft: BaseModel) -> str:
    return json.dumps(draft.model_dump())


def _view(a: Any) -> dict[str, Any] | None:
    """The twin view a document was raised from (X-ray machine + component), for reopening it later."""
    view = getattr(a, "view", None)
    return view.model_dump() if view is not None else None


class Reports:
    def __init__(self, hub: Any, llm: Any, fast_model: str, protocols: Any, records: Any, ml: Any,
                 cache_dir: Path, first_token_s: float = 5.0, total_s: float = 15.0) -> None:
        self.hub, self.llm, self.fast_model = hub, llm, fast_model
        self.protocols, self.records, self.ml = protocols, records, ml
        self.cache_dir = cache_dir
        self.first_token_s, self.total_s = first_token_s, total_s
        self._explanations: dict[str, dict[str, Any]] | None = None

    # ------------------------------------------------------------------ drafting core

    async def _draft(self, model: type[_Draft], system: str, facts: dict[str, Any],
                     extra_sources: list[Any] = (), validate=None) -> tuple[_Draft | None, str, list[str]]:
        if not self.llm.available:
            return None, "template (llm unavailable)", ["llm unavailable"]
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.total_s
        tool = {"name": "submit_draft", "description": "Submit the structured draft.",
                "input_schema": {k: v for k, v in model.model_json_schema().items() if k != "title"}}
        messages: list[dict[str, Any]] = [{"role": "user", "content": "Facts:\n" + json.dumps(facts, default=str)}]
        problems: list[str] = []
        for attempt in range(2):
            try:
                turn = await self.llm.turn(model=self.fast_model, system=[{"type": "text", "text": system + "\n" + RULES}],
                                           messages=messages, tools=[tool], max_tokens=1500, effort=None,
                                           on_text=None, first_token_s=self.first_token_s, deadline=deadline)
            except LLMError as exc:
                return None, f"template (llm {exc.code})", [exc.code]
            call = next((c for c in turn.tool_calls if c.name == "submit_draft"), None)
            problems = []
            draft = None
            if call is None:
                problems.append("no submit_draft call")
            else:
                try:
                    draft = model.model_validate(call.input)
                except ValidationError as exc:
                    problems += [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()]
            if draft is not None:
                rep = grounding.check(_texts(draft), [facts, *extra_sources])
                problems += [f"ungrounded value: {p}" for p in rep.problems]
                if validate:
                    problems += validate(draft)
            if not problems:
                return draft, f"llm:{self.fast_model}" + (" (after retry)" if attempt else ""), []
            if attempt == 0:
                messages.append({"role": "assistant", "content": turn.content})
                if call is not None:
                    messages.append({"role": "user", "content": [{
                        "type": "tool_result", "tool_use_id": call.id, "is_error": True,
                        "content": "Rejected: " + "; ".join(problems) + ". Fix these and call submit_draft again."}]})
                else:
                    messages.append({"role": "user", "content": "You must call submit_draft. " + "; ".join(problems)})
        return None, "template (validation failed twice)", problems

    # ------------------------------------------------------------------ incidents

    async def incident_facts(self, machine_id: str, event_id: str | None) -> dict[str, Any]:
        trigger = next((e for e in reversed(self.hub.ring) if event_id and e.get("id") == event_id), None)
        center = (parse_ts(trigger.get("ts")) if trigger else None) or time.time()
        p = self.hub.persister
        states = await p.machine_history(machine_id, center - 60, center + 60, 240)
        events = await p.events(from_s=center - 60, to_s=center + 60, machine_id=machine_id, limit=50)
        keep = ("ts", "status", "intent", "speed_mps", "seatbelt", "bubble", "nearest_person_m", "tip_over_margin",
                "hydraulic_temp_c", "payload_kg", "zone")
        step = max(1, len(states) // 5)
        m = self.hub.world.machines.get(machine_id, {})
        protocol = (trigger or {}).get("protocol")
        if protocol is None and trigger is not None and self.protocols is not None:
            p_obj = self.protocols.for_event(trigger)
            protocol = p_obj.ref() if p_obj else None
        reporting = self.protocols.by_id.get("PRT-INCIDENT").ref() if self.protocols and "PRT-INCIDENT" in self.protocols.by_id else None
        return {
            "machine_id": machine_id, "model": m.get("model"), "operator_id": m.get("operator_id"),
            "trigger_event": {k: trigger.get(k) for k in ("id", "ts", "event", "severity", "message", "data", "source")}
            if trigger else None,
            "window": {"from": now_iso_s(center - 60), "to": now_iso_s(center + 60), "states": len(states)},
            "state_samples": [{k: s.get(k) for k in keep if k in s} for s in states[::step][:6]],
            "events": [{k: e.get(k) for k in ("id", "ts", "event", "severity", "message")} for e in events],
            "environment": dict(self.hub.world.environment),
            "protocol": protocol, "reporting_protocol_id": reporting["id"] if reporting else None,
            "snapshot_url": ((trigger or {}).get("data") or {}).get("snapshot_url"),
        }

    def incident_template(self, facts: dict[str, Any]) -> IncidentDraft:
        t = facts.get("trigger_event")
        mid = facts["machine_id"]
        if t:
            title = f"{t['event'].replace('_', ' ')} on {mid}"
            summary = f"At {t['ts']}, {mid} raised {t['event']} ({t['severity']}): {t.get('message') or ''}".strip()
        else:
            title, summary = f"Incident report for {mid}", f"Incident reported for {mid} at {now_iso_s()}."
        timeline = [f"{e['ts']} {e['event']} ({e['severity']})" for e in facts.get("events", [])][:8]
        return IncidentDraft(title=title[:120], summary=summary[:800], timeline=timeline)

    async def file_incident(self, ctx: Any, a: Any, facts_hint: dict[str, Any] | None = None) -> dict[str, Any]:
        facts = await self.incident_facts(a.machine_id, a.event_id)
        facts["reported_by_user"] = a.summary
        component = getattr(a, "component", None)
        if component:
            facts["component"] = component
        draft, source, problems = await self._draft(
            IncidentDraft, "You write concise construction-site incident reports from machine data.", facts)
        if draft is None:
            draft = self.incident_template(facts)
        return await self.records.create("incident", {
            "machine_id": a.machine_id, "operator_id": facts.get("operator_id"), "event_id": a.event_id,
            "user_narrative": a.summary, "draft": draft.model_dump(), "draft_source": source,
            "draft_problems": problems, "facts": facts, "protocol": facts.get("protocol"),
            "snapshot_url": facts.get("snapshot_url"), "component": component,
            "source_view": _view(a)}, status="confirmed")

    # ------------------------------------------------------------------ work orders

    async def create_work_order(self, ctx: Any, a: Any, preview: dict[str, Any]) -> dict[str, Any]:
        forecast = preview.get("forecast") or []
        allowed_parts = sorted({p for f in forecast for p in f.get("recommended_parts", [])})
        component = getattr(a, "component", None)
        facts = {"machine_id": a.machine_id, "issue": a.issue, "fault_codes": preview.get("fault_codes", []),
                 "forecast": forecast, "allowed_parts": allowed_parts}
        if component:
            facts["component"] = component

        def parts_ok(d: WorkOrderDraft) -> list[str]:
            return [f"part not in forecast recommendations: {p}" for p in d.suggested_parts if p not in allowed_parts]

        draft, source, problems = await self._draft(
            WorkOrderDraft, "You draft maintenance work orders for a dealer technician.", facts, validate=parts_ok)
        if draft is None:
            hours = min((f.get("hours_to_service", 9999) for f in forecast), default=9999)
            priority = "high" if hours < 100 or facts["fault_codes"] else ("medium" if hours < 500 else "low")
            lines = [f"{f['component']}: health {f.get('health_pct')}%, service in {f.get('hours_to_service')} h"
                     for f in forecast[:3]]
            what = f" — {component.replace('_', ' ')}" if component else ""
            draft = WorkOrderDraft(title=f"Service request {a.machine_id}{what}"[:120],
                                   description=(a.issue + (". Fault codes: " + ", ".join(facts["fault_codes"])
                                                           if facts["fault_codes"] else "") +
                                                (". Forecast: " + "; ".join(lines) if lines else ""))[:800],
                                   priority=priority,
                                   suggested_parts=(forecast[0].get("recommended_parts", []) if forecast else [])[:6])
        return await self.records.create("work_order", {
            "machine_id": a.machine_id, "issue": a.issue, "draft": draft.model_dump(), "draft_source": source,
            "draft_problems": problems, "facts": facts, "component": component,
            "source_view": _view(a)}, status="draft")

    # ------------------------------------------------------------------ weekly owner report

    @property
    def weekly_path(self) -> Path:
        return self.cache_dir / "weekly_report.json"

    async def build_weekly(self) -> dict[str, Any]:
        try:
            summary = await self.ml.owner_summary(7)
        except MLUnavailable as exc:
            summary = {"error": str(exc), "provenance": "unavailable"}
        live = list(self.hub.world.machines.values())
        kpis = await self.ml.fleet_kpis({"machines": live, "environment": dict(self.hub.world.environment)})
        facts = {"owner_summary": {k: v for k, v in summary.items() if k != "daily"}, "fleet_kpis": kpis}
        draft, source, problems = await self._draft(
            Prose, "Write a 3-4 sentence weekly fleet summary for the machine owner: costs, fuel, idle, "
                   "utilisation, top anomalies. Plain business English.", facts)
        if draft is None:
            s = summary
            text = (f"Last {s.get('days', 7)} days: fuel {s.get('fuel_l')} L (INR {s.get('fuel_spend_inr')}), "
                    f"idle cost INR {s.get('idle_cost_inr')} ({s.get('idle_cost_share_pct')}% of spend), "
                    f"utilisation {s.get('utilization_pct')}%, CO2 {s.get('co2_kg')} kg.") if "error" not in s \
                else "Weekly figures are unavailable: the history data is not loaded."
            draft = Prose(text=text)
        report = {"generated_at": now_iso_s(), "prose": draft.text, "prose_source": source,
                  "prose_problems": problems, "data": summary, "kpis": kpis,
                  "provenance": {"summary": summary.get("provenance", "history"), "kpis": kpis.get("provenance")}}
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(self.weekly_path.write_text, json.dumps(report, default=str))
        return report

    async def weekly(self, max_age_s: float = 24 * 3600) -> dict[str, Any] | None:
        if self.weekly_path.exists() and time.time() - self.weekly_path.stat().st_mtime < max_age_s:
            return json.loads(await asyncio.to_thread(self.weekly_path.read_text))
        return None

    # ------------------------------------------------------------------ anomaly explanations

    @staticmethod
    def anomaly_key(a: dict[str, Any]) -> str:
        return f"{a.get('machine_id')}|{a.get('type')}|{(a.get('window') or {}).get('start')}"

    async def explain_anomaly(self, a: dict[str, Any]) -> dict[str, Any]:
        path = self.cache_dir / "anomaly_explanations.json"
        if self._explanations is None:
            self._explanations = json.loads(path.read_text()) if path.exists() else {}
        key = self.anomaly_key(a)
        if key in self._explanations:
            return {**self._explanations[key], "cached": True}
        draft, source, _ = await self._draft(
            Prose, "Explain this machine-usage anomaly to the owner in 1-2 sentences, including the fuel cost.", a)
        if draft is None:
            ev = a.get("evidence", {})
            parts = [f"{a.get('machine_id')}: {str(a.get('type', '')).replace('_', ' ')}"]
            if "idle_min" in ev:
                parts.append(f"idle {ev['idle_min']} min")
            if "load_cycles" in ev:
                parts.append(f"{ev['load_cycles']} load cycles")
            if a.get("fuel_cost_inr") is not None:
                parts.append(f"about INR {a['fuel_cost_inr']} of fuel")
            draft = Prose(text=", ".join(parts) + ".")
        out = {"explanation": draft.text, "source": source}
        self._explanations[key] = out
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_text, json.dumps(self._explanations))
        return {**out, "cached": False}
