"""Specialist routing (P2_SPEC §5c; VISION §11 scoped to one agent loop).

rules first (weighted keyword regexes)  ->  if ambiguous: one fast-LLM classification (1.5 s)
->  on timeout/error/no LLM: the general profile with every tool on the surface.
No agent-to-agent calls: a specialist is just a prompt + a tool subset on the single loop.

The safety specialist is special: when the question names a safety event, the matching protocol is
fetched by code (not by the model) and its steps are appended verbatim to the answer.
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass
from typing import Any

from copilot.agent.llm import LLMError
from copilot.agent.loop import Route

MARGIN = 1.0
LLM_TIMEOUT_S = 1.5


@dataclass(frozen=True)
class Specialist:
    id: str
    label: str
    prompt: str
    rules: tuple[tuple[str, float], ...]


SPECIALISTS: dict[str, Specialist] = {s.id: s for s in (
    Specialist("safety", "Safety", (
        "You are the safety specialist. For any 'what do I do' question about an alert, call get_protocol and "
        "tell the user the protocol applies; the system appends the protocol steps verbatim after your text, so "
        "do NOT restate, paraphrase or add steps yourself. Keep your own text to one short sentence."),
        ((r"seat ?belt|\bbelt\b|buckle", 2), (r"proximity|behind me|blind spot|worker (?:near|behind)|person (?:near|behind)|someone behind", 2),
         (r"fatigue|tired|sleepy|drows|eyes closed", 2), (r"\btip(?:ping)?\b|tip-over|rollover|overturn|stability|margin", 2),
         (r"collision|crash|reversing", 2), (r"\bsafe\b|safety|danger|hazard|alarm|alert", 1),
         (r"what (?:do|should) i do|what now", 1), (r"incident|near miss|injur", 1.5))),
    Specialist("planner", "Planner", (
        "You are the planning specialist: tasks, sequencing, time estimates and what-if. Quote time estimates "
        "as the P50 with the P10-P90 range and name the top reasons if the tool gives them."),
        ((r"\btasks?\b|schedule|\bplan\b|reorder|re-?sequence|next job|shift plan", 2),
         (r"how long|\beta\b|finish|time estimate|will (?:it|this) take", 2), (r"what[- ]if|add(?:ed)? trucks?|extra trucks?", 2),
         (r"trench|excavat|haul", 0.5))),
    Specialist("maintenance", "Maintenance", (
        "You are the maintenance specialist: machine health, fault codes, service forecasts and work orders. "
        "Cite the manual for fault codes."),
        ((r"service|maintenance|filter|\boil\b|fault|code|hyd-\d+|repair|work order|breakdown|\bwear\b|pump|engine|"
          r"hydraulic|coolant|overheat", 1.5),)),
    Specialist("training", "Training", (
        "You are the training specialist: modules, skills and bookings. Recommend a module only from the "
        "training modules the tools know."),
        ((r"training|\btrain\b|course|module|learn|practi[cs]e|instructor|lesson|skill|book (?:me|a|on)", 2),)),
    Specialist("reporting", "Reporting", (
        "You are the reporting specialist for owners and managers: costs, fuel, utilisation, anomalies and "
        "summaries. Lead with the number that matters most."),
        ((r"report|summary|weekly|\bcost|spend|carbon|co2|utili[sz]ation|\bkpi|anomal|idle cost|owner|\bfuel used", 2),)),
    Specialist("coordination", "Coordination", (
        "You are the site coordination specialist: machine interactions, queues, haul traffic and who is "
        "waiting for what. Explain using only the fleet and event data."),
        ((r"coordinat|queue|loader|haul road|right of way|\byield|waiting|dispatch|traffic|v2v|convoy|"
          r"which trucks?|where (?:is|are)", 1.5),)),
)}
GENERAL = Route(id="general", label="General", routed_by="fallback", confidence=0.0)

#: safety keyword -> the event whose protocol answers "what do I do"
SAFETY_EVENT_RULES: tuple[tuple[str, str, dict[str, Any]], ...] = (
    (r"seat ?belt|\bbelt\b|buckle", "seatbelt_unfastened", {}),
    (r"proximity|behind me|blind spot|worker|person|someone", "proximity_alert", {}),
    (r"fatigue|tired|sleepy|drows|eyes closed", "fatigue_alert", {}),
    (r"\btip(?:ping)?\b|tip-over|rollover|overturn|stability", "tip_over_warning", {}),
    (r"collision|crash|reversing|v2v", "v2v_collision_risk", {}),
    (r"hyd-118|hydraulic.*(?:hot|temp|overheat)|overheat", "maintenance_due", {"component": "hydraulic_pump"}),
)


def rule_scores(message: str) -> dict[str, float]:
    low = message.lower()
    return {sid: sum(w for pat, w in s.rules if re.search(pat, low)) for sid, s in SPECIALISTS.items()}


def safety_event(message: str) -> tuple[str, dict[str, Any]] | None:
    low = message.lower()
    for pat, evt, data in SAFETY_EVENT_RULES:
        if re.search(pat, low):
            return evt, data
    return None


class Router:
    def __init__(self, llm: Any, fast_model: str, registry: Any, llm_timeout_s: float = LLM_TIMEOUT_S) -> None:
        self.llm, self.fast_model, self.registry = llm, fast_model, registry
        self.llm_timeout_s = llm_timeout_s
        self.last_overhead_ms = 0.0

    def _route(self, sid: str, routed_by: str, confidence: float, message: str) -> Route:
        s = SPECIALISTS[sid]
        tools = {t.name for t in self.registry.tools.values() if sid in t.specialists}
        route = Route(id=sid, label=s.label, routed_by=routed_by, confidence=round(confidence, 2), prompt=s.prompt,
                      tool_names=tools)
        if sid == "safety":
            route.protocol_event = safety_event(message)
        return route

    async def route(self, message: str, surface: str) -> Route:
        t0 = time.perf_counter()
        try:
            scores = rule_scores(message)
            ranked = sorted(scores.items(), key=lambda kv: -kv[1])
            (top, top_s), (_, second_s) = ranked[0], ranked[1]
            if top_s > 0 and top_s - second_s >= MARGIN:
                return self._route(top, "rules", top_s / (top_s + second_s), message)
            picked = await self._llm_pick(message, [sid for sid, sc in ranked if sc > 0] or list(SPECIALISTS))
            if picked is not None:
                return self._route(picked, "llm", 0.7, message)
            return GENERAL
        finally:
            self.last_overhead_ms = (time.perf_counter() - t0) * 1000

    async def _llm_pick(self, message: str, candidates: list[str]) -> str | None:
        if not self.llm.available:
            return None
        options = candidates + ["general"]
        tool = {"name": "route", "description": "Pick the specialist for the user's message.",
                "input_schema": {"type": "object", "additionalProperties": False, "required": ["specialist"],
                                 "properties": {"specialist": {"type": "string", "enum": options}}}}
        system = [{"type": "text", "text": "Route construction-site assistant questions. Specialists: " + "; ".join(
            f"{sid}: {SPECIALISTS[sid].label}" for sid in candidates) + "; general: anything else. Call route once."}]
        loop = asyncio.get_running_loop()
        try:
            turn = await self.llm.turn(model=self.fast_model, system=system,
                                       messages=[{"role": "user", "content": message}], tools=[tool], max_tokens=200,
                                       effort=None, on_text=None, first_token_s=self.llm_timeout_s,
                                       deadline=loop.time() + self.llm_timeout_s)
        except LLMError:
            return None
        call = next((c for c in turn.tool_calls if c.name == "route"), None)
        pick = (call.input or {}).get("specialist") if call and isinstance(call.input, dict) else None
        return pick if pick in SPECIALISTS else None
