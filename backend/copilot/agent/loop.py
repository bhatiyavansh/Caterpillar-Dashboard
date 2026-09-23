"""The agent loop (P2_SPEC §5.3): one assistant request -> a stream of SSE events.

    meta -> [specialist] -> status -> (token* -> tool_call* -> tool_result* -> confirm_required*)x<=5
         -> final -> done           (error events are emitted when a fallback is used)

Deadline: 20 s for the whole request, 5 s to first token per round. On any LLM failure the answer
is built deterministically from tool results (or read-only tools chosen by keyword rules), so the
user always gets facts from data - never a made-up answer and never silence.
"""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import time
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from copilot.agent import grounding
from copilot.agent.fallback import deterministic_answer
from copilot.agent.llm import LLMError, LLMPort
from copilot.agent.prompts import live_context, system_blocks
from copilot.agent.registry import ToolContext, ToolRegistry, ToolResult
from copilot.contracts.assistant import AssistantRequest

EFFORT = {"cab": "low", "training": "low", "ar": "low", "command": "medium", "owner": "medium"}
TOOL_RESULT_CHARS = 6000  # free tiers allow ~8k tokens/min per model; a turn resends every result each round
SpeakMax = {"cab": 2, "ar": 2, "training": 3, "command": 3, "owner": 3}
MACHINE_RE = re.compile(r"\b[A-Z]{3}\d{3}\b")


@dataclass
class AgentSettings:
    model: str = "claude-opus-5"
    fast_model: str = "claude-haiku-4-5"
    first_token_s: float = 5.0
    total_s: float = 20.0
    max_rounds: int = 5
    max_tokens: int = 4096
    log_path: Path | None = None


@dataclass
class Route:
    id: str = "general"
    label: str = "General"
    routed_by: str = "fallback"
    confidence: float = 0.0
    prompt: str | None = None
    tool_names: set[str] | None = None  # None = all tools allowed on the surface
    protocol_event: tuple[str, dict[str, Any]] | None = None  # safety: protocol fetched by code, steps appended


@dataclass
class _Turn:
    turn_id: str
    req: AssistantRequest
    results: list[tuple[str, ToolResult]] = field(default_factory=list)
    actions: list[dict[str, Any]] = field(default_factory=list)
    citations: list[dict[str, Any]] = field(default_factory=list)
    log: dict[str, Any] = field(default_factory=dict)


def rule_calls(message: str, machine_id: str | None, surface: str) -> list[tuple[str, dict[str, Any]]]:
    """Read-only tools picked by keywords, for the no-LLM path."""
    low = message.lower()
    ids = MACHINE_RE.findall(message.upper()) or ([machine_id] if machine_id else [])
    calls: list[tuple[str, dict[str, Any]]] = []
    if re.search(r"task|job|trench|schedule|next", low) and (ids or machine_id):
        calls.append(("get_shift_tasks", {"machine_id": (ids or [machine_id])[0]}))
    if re.search(r"alert|event|happen|warning|why did", low):
        calls.append(("get_recent_events", {"machine_id": ids[0]} if ids else {}))
    if re.search(r"anomal|idl|unusual", low):
        calls.append(("get_anomalies", {"machine_id": ids[0]} if ids else {}))
    if re.search(r"service|maintenance|filter|due", low):
        calls.append(("get_maintenance_forecast", {"machine_id": ids[0]} if ids else {}))
    if re.search(r"fleet|site|all machines|overview", low) and surface != "cab":
        calls.append(("get_fleet_overview", {}))
    if not calls and ids:
        calls += [("get_machine_status", {"machine_id": i}) for i in ids[:3]]
    return calls


def citations_from(name: str, res: ToolResult) -> list[dict[str, Any]]:
    """Manual passages and protocols a tool returned become citations (shown by the UI, spoken never)."""
    if not res.ok or not isinstance(res.data, dict):
        return []
    if name == "search_manual":
        return [{"kind": "manual", "doc_id": h["doc_id"], "title": h["title"], "page": h.get("page"),
                 "section": h.get("section"), "citation": h["citation"], "quote": h["quote"][:400]}
                for h in res.data.get("hits", [])[:3]]
    if name == "get_protocol" and res.data.get("found"):
        p = res.data["protocol"]
        out = [{"kind": "protocol", "doc_id": p["id"], "title": p["title"], "step": i + 1, "quote": step,
                "citation": p["source"]} for i, step in enumerate(p["steps"])]
        if p.get("regulation"):
            out.append({"kind": "manual", "doc_id": p["id"], "title": p["regulation"]["citation"],
                        "quote": p["regulation"]["quote"], "citation": p["regulation"]["citation"]})
        return out
    return []


def protocol_block(p: dict[str, Any]) -> str:
    """The verbatim protocol block appended by code to safety answers (never written by the LLM)."""
    steps = "\n".join(f"{i}. {step}" for i, step in enumerate(p["steps"], 1))
    return f"{p['title']} ({p['id']}, {p['source']}):\n{steps}"


def speak(text: str, surface: str) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(sentences[: SpeakMax.get(surface, 2)])


class Agent:
    def __init__(self, llm: LLMPort, registry: ToolRegistry, hub: Any,
                 context_factory: Callable[[AssistantRequest], ToolContext], settings: AgentSettings,
                 router: Any = None) -> None:
        self.llm = llm
        self.registry = registry
        self.hub = hub
        self.context_factory = context_factory
        self.s = settings
        self.router = router
        self.memory: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    # ------------------------------------------------------------------ public

    async def run(self, req: AssistantRequest) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.s.total_s
        t = _Turn(f"turn_{secrets.token_hex(5)}", req)
        t0 = time.monotonic()
        mode = "live" if self.llm.available else "fallback"
        yield "meta", {"turn_id": t.turn_id, "surface": req.surface, "mode": mode,
                       "model": self.s.model if mode == "live" else None}

        route = Route()
        if self.router is not None:
            route = await self.router.route(req.message, req.surface)
            yield "specialist", {"id": route.id, "label": route.label, "routed_by": route.routed_by,
                                 "confidence": route.confidence}

        ctx = self.context_factory(req)
        protocol: dict[str, Any] | None = None
        if route.protocol_event is not None:  # deterministic: the protocol is fetched by code, not the model
            evt, data = route.protocol_event
            args = {"event": evt, **({"component": data["component"]} if "component" in data else {})}
            async for ev in self._run_tools(t, ctx, Route(), [("protocol_0", "get_protocol", args)]):
                yield ev
            res = t.results[-1][1]
            if res.ok and res.data.get("found"):
                protocol = res.data["protocol"]
        final_text: str | None = None
        grounded = True
        llm_grounded: bool | None = None
        error: dict[str, Any] | None = None

        if mode == "live":
            try:
                async for ev in self._llm_rounds(t, ctx, route, deadline):
                    if ev[0] == "_final":
                        final_text, llm_grounded = ev[1]["text"], ev[1]["grounded"]
                    else:
                        yield ev
            except LLMError as exc:
                error = {"code": exc.code, "message": str(exc), "fallback_used": True}
                mode = "fallback"
        else:
            error = {"code": "llm_unavailable", "message": "no LLM configured (ANTHROPIC_API_KEY unset)",
                     "fallback_used": True}

        if final_text is None and protocol is not None:  # safety answer needs no LLM at all
            final_text = "Follow the site protocol for this alert."
            if error:
                yield "error", error
        if final_text is None:  # fallback: facts from tools only
            if not t.results:
                async for ev in self._run_tools(t, ctx, route, [(f"rule_{i}", n, a) for i, (n, a) in
                                                                  enumerate(rule_calls(req.message, req.machine_id, req.surface))]):
                    yield ev
            final_text = deterministic_answer(t.results, error["code"] if error else "rounds")
            if error:
                yield "error", error
        elif llm_grounded is False:
            grounded = True  # delivered text is the deterministic, data-only answer
        speak_text = speak(final_text, req.surface)
        if protocol is None:  # the model looked a protocol up itself: its steps still come from the file, verbatim
            protocol = next((r.data["protocol"] for n, r in t.results
                             if n == "get_protocol" and r.ok and r.data.get("found")), None)
        if protocol is not None:
            final_text = final_text.rstrip() + "\n\n" + protocol_block(protocol)
            speak_text = (speak_text + " " + " ".join(protocol["steps"])).strip()
        yield "status", {"state": "answering"}
        final = {"text": final_text, "speak_text": speak_text, "citations": t.citations,
                 "actions": t.actions, "grounded": grounded}
        yield "final", final
        yield "done", {}
        self._remember(req, final_text)
        t.log.update(turn_id=t.turn_id, ts=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), surface=req.surface,
                     message=req.message, mode=mode, specialist=route.id, error=error, final=final,
                     llm_grounded=llm_grounded, latency_ms=int((time.monotonic() - t0) * 1000),
                     tools=[{"name": n, "ok": r.ok, "provenance": r.provenance} for n, r in t.results])
        await self._log(t.log)

    async def collect(self, req: AssistantRequest) -> dict[str, Any]:
        """Non-streaming: run and return the `final` payload plus every event (for JSON callers/tests)."""
        events: list[tuple[str, dict[str, Any]]] = [ev async for ev in self.run(req)]
        final = next(p for n, p in events if n == "final")
        return {"final": final, "events": events}

    # ------------------------------------------------------------------ internals

    def _history(self, req: AssistantRequest) -> list[dict[str, Any]]:
        if not req.conversation_id:
            return []
        ts, msgs = self.memory.get(req.conversation_id, (0.0, []))
        return list(msgs) if time.monotonic() - ts < 1800 else []

    def _remember(self, req: AssistantRequest, answer: str) -> None:
        if not req.conversation_id:
            return
        msgs = self._history(req) + [{"role": "user", "content": req.message},
                                     {"role": "assistant", "content": answer}]
        self.memory[req.conversation_id] = (time.monotonic(), msgs[-12:])

    async def _llm_rounds(self, t: _Turn, ctx: ToolContext, route: Route, deadline: float):
        req = t.req
        tools = self.registry.for_surface(req.surface, route.tool_names)
        schemas = [tool.schema() for tool in tools]
        live = live_context(self.hub, req.surface, req.machine_id, req.operator_id)
        system = system_blocks(req.surface, route.prompt, live)
        messages = self._history(req) + [{"role": "user", "content": req.message}]
        effort = EFFORT.get(req.surface, "low")
        for _ in range(self.s.max_rounds):
            yield "status", {"state": "thinking"}
            queue: asyncio.Queue[str] = asyncio.Queue()
            task = asyncio.create_task(self.llm.turn(
                model=self.s.model, system=system, messages=messages, tools=schemas, max_tokens=self.s.max_tokens,
                effort=effort, on_text=queue.put_nowait, first_token_s=self.s.first_token_s, deadline=deadline))
            try:
                while not task.done() or not queue.empty():
                    getter = asyncio.ensure_future(queue.get())
                    done, _ = await asyncio.wait({getter, task}, return_when=asyncio.FIRST_COMPLETED)
                    if getter in done:
                        yield "token", {"delta": getter.result()}
                    else:
                        getter.cancel()
            finally:
                if not task.done():
                    task.cancel()
            turn = task.result()  # raises LLMError
            messages.append({"role": "assistant", "content": turn.content})
            if not turn.tool_calls:
                text = turn.text.strip()
                report = grounding.check(text, [r.for_model() for _, r in t.results] + [live], req.message)
                if not report.grounded and asyncio.get_running_loop().time() < deadline - 1:
                    messages.append({"role": "user", "content": (
                        "Correction from the system: your answer contains values that are not in the tool results "
                        f"or live context: {', '.join(report.problems)}. Restate the answer using only values from "
                        "the tool results, or say plainly that you do not have that information.")})
                    retry = await self.llm.turn(model=self.s.model, system=system, messages=messages, tools=schemas,
                                                max_tokens=self.s.max_tokens, effort=effort, on_text=None,
                                                first_token_s=self.s.first_token_s, deadline=deadline)
                    text = retry.text.strip()
                    report = grounding.check(text, [r.for_model() for _, r in t.results] + [live], req.message)
                t.log["grounding"] = {"grounded": report.grounded, "problems": report.problems}
                if not report.grounded:
                    yield "_final", {"text": deterministic_answer(t.results, "ungrounded"), "grounded": False}
                else:
                    yield "_final", {"text": text or deterministic_answer(t.results, "empty"), "grounded": True}
                return
            calls = [(c.id, c.name, c.input) for c in turn.tool_calls]
            yield "status", {"state": "calling_tool"}
            results_blocks: list[dict[str, Any]] = []
            async for ev in self._run_tools(t, ctx, route, calls, results_blocks):
                yield ev
            messages.append({"role": "user", "content": results_blocks})
        # out of rounds while the model still wanted tools
        yield "_final", {"text": deterministic_answer(t.results, "max_rounds"), "grounded": False}

    async def _run_tools(self, t: _Turn, ctx: ToolContext, route: Route, calls, results_blocks=None):
        allowed = route.tool_names
        for call_id, name, args in calls:
            yield "tool_call", {"call_id": call_id, "name": name, "args": args if isinstance(args, dict) else {}}

        async def one(call_id: str, name: str, args: Any):
            if allowed is not None and name not in allowed:
                from copilot.agent.registry import ToolResult as TR

                return TR(False, {"error": f"{name} is not available to this specialist"}, "router", "not allowed"), 0
            return await self.registry.call(name, args, ctx)

        outcomes = await asyncio.gather(*(one(*c) for c in calls))
        for (call_id, name, _), (res, ms) in zip(calls, outcomes, strict=True):
            t.results.append((name, res))
            yield "tool_result", {"call_id": call_id, "name": name, "ok": res.ok, "summary": res.summary,
                                  "provenance": res.provenance, "latency_ms": ms}
            for cit in citations_from(name, res):
                if cit not in t.citations:
                    t.citations.append(cit)
                    yield "citation", cit
            if res.pending_action:
                a = res.pending_action
                payload = {"action_id": a["action_id"], "tool": a["tool"], "args": a["args"],
                           "summary": a["summary"], "expires_at": a["expires_at"]}
                t.actions.append(payload)
                yield "confirm_required", payload
            if results_blocks is not None:
                results_blocks.append({"type": "tool_result", "tool_use_id": call_id,
                                       "content": json.dumps(res.for_model(), default=str)[:TOOL_RESULT_CHARS],
                                       "is_error": not res.ok})

    async def _log(self, record: dict[str, Any]) -> None:
        if self.s.log_path is None:
            return
        line = json.dumps(record, default=str) + "\n"

        def _append() -> None:
            self.s.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.s.log_path.open("a") as f:
                f.write(line)

        await asyncio.to_thread(_append)
