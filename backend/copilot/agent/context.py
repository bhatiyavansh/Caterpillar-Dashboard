"""Specialist-scoped context (the step between the router and the model).

The router picks a specialist; this module decides what that specialist sees before it calls any tool:

    base live context (prompts.live_context: environment, source, my machine, active alerts)
      + the specialist's slice of live data   (safety: people and recent safety events,
                                               maintenance: temperatures and faults, planner: fleet...)
      + the screen's context                  (training: lesson step, validator verdict, lesson machine)
      + a retrieval query                     (the message; a vague follow-up also gets the context terms)

Everything is compact, drawn from the hub's World/ring or the request, and passed to the grounding
check as a source, so a number the model repeats from here is grounded and anything else is not.
Nothing here is written by a model.
"""

from __future__ import annotations

import re
import time
from typing import Any

from copilot.agent.prompts import live_context
from copilot.contracts.assistant import AssistantRequest
from copilot.timeutil import parse_ts

SAFETY_KINDS = frozenset({"seatbelt_unfastened", "seatbelt_fastened", "proximity_alert", "fatigue_alert",
                          "tip_over_warning", "v2v_collision_risk", "emergency_stop"})
MAINTENANCE_KINDS = frozenset({"maintenance_due", "engine_fault", "low_fuel", "anomaly_detected"})

#: machine fields each specialist needs (the base context already carries a short common set)
MACHINE_FIELDS: dict[str, tuple[str, ...]] = {
    "safety": ("seatbelt", "bubble", "nearest_person_m", "tip_over_margin", "speed_mps", "intent", "status",
               "fatigue_score", "engine_on"),
    "operations": ("status", "intent", "engine_on", "speed_mps", "seatbelt", "bubble", "nearest_person_m",
                   "tip_over_margin", "zone", "task_id", "task_progress", "task_eta_min", "fault_codes"),
    "maintenance": ("hydraulic_temp_c", "coolant_temp_c", "fault_codes", "engine_hours", "fuel_level_pct",
                    "idle_min", "status"),
    "training": ("status", "intent", "speed_mps", "seatbelt", "bubble", "nearest_person_m", "tip_over_margin"),
    "planner": ("status", "zone", "task_id", "task_progress", "task_eta_min"),
    "coordination": ("status", "zone", "intent", "speed_mps", "task_id"),
}
RECENT_WINDOW_S = 15 * 60


def _compact(obj: Any) -> Any:
    """Drop empty values so the prompt carries only what is known."""
    if isinstance(obj, dict):
        return {k: _compact(v) for k, v in obj.items() if v not in (None, "", [], {})}
    if isinstance(obj, list):
        return [_compact(v) for v in obj]
    return obj


def _recent_events(hub: Any, kinds: frozenset[str] | None, machine_id: str | None, limit: int) -> list[dict[str, Any]]:
    cutoff = time.time() - RECENT_WINDOW_S
    out: list[dict[str, Any]] = []
    for e in reversed(hub.ring):
        if e.get("type") != "event":
            continue
        if (parse_ts(e.get("ts")) or 0) < cutoff:
            break
        if kinds is not None and e.get("event") not in kinds:
            continue
        if machine_id and e.get("machine_id") not in (machine_id, None):
            continue
        out.append({k: e.get(k) for k in ("id", "ts", "event", "severity", "machine_id", "message")})
        if len(out) >= limit:
            break
    return out


def _fleet_brief(hub: Any, fields: tuple[str, ...]) -> list[dict[str, Any]]:
    return [{"machine_id": mid, **{k: m[k] for k in fields if k in m}}
            for mid, m in sorted(hub.world.machines.items())]


def _workers_near(hub: Any, machine: dict[str, Any] | None, limit: int = 3) -> list[dict[str, Any]]:
    pos = (machine or {}).get("pos") or {}
    if not isinstance(pos, dict) or "x" not in pos or "y" not in pos:
        return []
    near = []
    for wid, w in hub.world.workers.items():
        wp = w.get("pos") or {}
        if isinstance(wp, dict) and "x" in wp and "y" in wp:
            d = ((wp["x"] - pos["x"]) ** 2 + (wp["y"] - pos["y"]) ** 2) ** 0.5
            near.append({"worker_id": wid, "distance_m": round(d, 1), "zone": w.get("zone")})
    return sorted(near, key=lambda w: w["distance_m"])[:limit]


def training_context(req: AssistantRequest) -> dict[str, Any] | None:
    tc = req.context.training if req.context else None
    if tc is None:
        return None
    data = _compact(tc.model_dump(mode="json"))
    data["verdicts_from"] = "the lesson's telemetry validator (sensors), never the assistant"
    return data


def build_context(hub: Any, req: AssistantRequest, specialist: str) -> dict[str, Any]:
    ctx = live_context(hub, req.surface, req.machine_id, req.operator_id)
    ctx["specialist"] = specialist
    if req.context and req.context.route:
        ctx["screen"] = req.context.route

    machine = hub.world.machines.get(req.machine_id) if req.machine_id else None
    extra_fields = MACHINE_FIELDS.get(specialist)
    if machine and extra_fields and isinstance(ctx.get("my_machine"), dict):
        ctx["my_machine"].update({k: machine[k] for k in extra_fields if k in machine})

    if specialist in ("safety", "operations", "training"):
        ctx["recent_safety_events"] = _recent_events(hub, SAFETY_KINDS, req.machine_id, 8)
        workers = _workers_near(hub, machine)
        if workers:
            ctx["workers_near_my_machine"] = workers
    if specialist in ("maintenance", "operations"):
        ctx["recent_machine_events"] = _recent_events(hub, MAINTENANCE_KINDS, req.machine_id, 6)
    if specialist in ("planner", "coordination"):
        ctx["fleet"] = _fleet_brief(hub, MACHINE_FIELDS[specialist])

    training = training_context(req)
    if training is not None:
        ctx["training"] = training
    return _compact(ctx)


_WORD = re.compile(r"[a-z][a-z_ -]+")
_DEICTIC = re.compile(r"\b(?:that|this|it|these|those|there)\b", re.IGNORECASE)
_GENERIC = frozenset("""what why how when where who which should would could can do does did done i me my you your we
    is are was were be been am a an the to of and or in on for with it that this now right wrong next happening
    explain differently example give tell important matter mean please again simpler way just so about""".split())


def is_follow_up(message: str) -> bool:
    """"Why is that important?", "what did I do wrong?": the question only makes sense with the screen's
    context. A self-contained question ("what should I check before starting?") is searched as asked."""
    content = [w for w in re.findall(r"[a-z']+", message.lower()) if w not in _GENERIC and len(w) > 2]
    return bool(_DEICTIC.search(message)) or len(content) < 2


_ALERT_Q = re.compile(r"warning|alert|alarm|beep|chime|siren|light", re.IGNORECASE)
_MISTAKE_Q = re.compile(r"wrong|mistake|fail|missed|didn'?t (?:work|pass)|not work", re.IGNORECASE)
_STEP_Q = re.compile(r"\bnext\b|what now|this step|right now|happening", re.IGNORECASE)


def retrieval_query(req: AssistantRequest, specialist: str, context: dict[str, Any],
                    previous: str | None = None) -> str:
    """The user's words, plus, for a vague follow-up only, what "that" most likely refers to:

        a warning/alert question  -> the alerts open right now (lesson simulator's or the site's)
        a "what did I do wrong"   -> the validator's diagnosis and the step
        "what next" in a lesson   -> the current step
        otherwise                 -> the previous question in this conversation, else the current step
    """
    open_kinds = sorted({str(a.get("event", "")).replace("_", " ") for a in context.get("active_alerts", [])
                         if a.get("event") and (not req.machine_id or a.get("machine_id") in (req.machine_id, None))})
    if not is_follow_up(req.message):
        # an open safety alert on the operator's machine is almost always what a safety/operations
        # question is about ("why can't I move?" with the seatbelt unfastened)
        if specialist in ("safety", "operations") and open_kinds:
            return f"{req.message} {' '.join(open_kinds[:2])}"[:300]
        return req.message[:300]
    tr = context.get("training") or {}
    terms: list[str] = []
    if _ALERT_Q.search(req.message):
        terms += [f"{a.get('title', '')} {a.get('message', '')}" for a in (tr.get("alerts") or [])[:2]]
        terms += open_kinds[:3]
    elif _MISTAKE_Q.search(req.message) and tr.get("last_failure_reason"):
        terms += [str(tr["last_failure_reason"]), str(tr.get("module_title", ""))]
    elif _STEP_Q.search(req.message) and tr.get("lesson_active"):
        terms += [str(tr[k]) for k in ("module_title", "step_instruction", "real_control") if tr.get(k)]
    if not terms and previous and not is_follow_up(previous):
        terms.append(previous)
    if not terms and tr:
        terms += [str(tr[k]) for k in ("module_title", "step_instruction", "real_control") if tr.get(k)]
    if not terms and specialist in ("maintenance", "operations"):
        terms += [str(c) for c in ((context.get("my_machine") or {}).get("fault_codes") or [])[:3]]
    extra = " ".join(t for t in terms if t and _WORD.search(t.lower()))
    return f"{req.message} {extra}".strip()[:300]


#: specialists whose answers are taught from documents: their evidence is retrieved by code before the
#: model runs, so the model explains retrieved passages instead of recalling (or inventing) them
PREFETCH_SPECIALISTS = frozenset({"training", "safety", "maintenance", "operations"})


def wants_prefetch(req: AssistantRequest, specialist: str) -> bool:
    return specialist in PREFETCH_SPECIALISTS or (specialist == "general" and req.surface == "training")
