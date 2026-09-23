"""Free-tier LLM providers (Groq, Gemini) via their OpenAI-compatible chat APIs, plus a fallback chain.

The agent loop speaks Anthropic-style blocks (text / tool_use / tool_result); this adapter converts
them to OpenAI chat messages and back, so nothing else changes. Model names "main" and "fast" resolve
to the provider's configured models. Non-streaming: one request per round, bounded by the deadline.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
from typing import Any

import httpx

from copilot.agent.llm import LLMError, LLMTurn, ToolCall, _emit

PROVIDERS: dict[str, dict[str, str]] = {
    "groq": {"base": "https://api.groq.com/openai/v1", "key": "GROQ_API_KEY",
             "main": "llama-3.3-70b-versatile", "fast": "llama-3.1-8b-instant", "vision": ""},
    "gemini": {"base": "https://generativelanguage.googleapis.com/v1beta/openai", "key": "GEMINI_API_KEY",
               "main": "gemini-2.5-flash", "fast": "gemini-2.5-flash-lite", "vision": "gemini-2.5-flash"},
}


def _to_openai(system: list[dict[str, Any]], messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [{"role": "system", "content": "\n\n".join(b["text"] for b in system)}]
    for m in messages:
        content = m["content"]
        if isinstance(content, str):
            out.append({"role": m["role"], "content": content})
            continue
        if m["role"] == "assistant":
            text = "".join(b.get("text", "") for b in content if b.get("type") == "text")
            calls = [{"id": b["id"], "type": "function",
                      "function": {"name": b["name"], "arguments": json.dumps(b.get("input") or {})}}
                     for b in content if b.get("type") == "tool_use"]
            msg: dict[str, Any] = {"role": "assistant", "content": text or None}
            if calls:
                msg["tool_calls"] = calls
            out.append(msg)
        else:
            for b in content:
                if b.get("type") == "tool_result":
                    out.append({"role": "tool", "tool_call_id": b["tool_use_id"], "content": str(b.get("content", ""))})
                elif b.get("type") == "text":
                    out.append({"role": "user", "content": b["text"]})
    return out


class OpenAICompatLLM:
    def __init__(self, provider: str, api_key: str | None = None, main: str | None = None, fast: str | None = None):
        cfg = PROVIDERS[provider]
        self.name = provider
        self._key = api_key or os.environ.get(cfg["key"])
        self.base = cfg["base"]
        self.models = {"main": main or os.environ.get(f"{provider.upper()}_MODEL", cfg["main"]),
                       "fast": fast or os.environ.get(f"{provider.upper()}_FAST_MODEL", cfg["fast"])}
        self.vision = cfg["vision"]
        self._client = httpx.AsyncClient(timeout=20.0) if self._key else None

    @property
    def available(self) -> bool:
        return self._client is not None

    def resolve(self, model: str) -> str:
        return self.models.get(model, model)

    async def _post(self, body: dict[str, Any], deadline: float) -> dict[str, Any]:
        loop = asyncio.get_running_loop()
        try:
            async with asyncio.timeout_at(deadline):
                r = await self._client.post(f"{self.base}/chat/completions", json=body,
                                            headers={"Authorization": f"Bearer {self._key}"})
        except TimeoutError as exc:
            raise LLMError("total_timeout", f"{self.name} deadline reached") from exc
        except httpx.HTTPError as exc:
            raise LLMError("unavailable", f"{self.name}: {exc!r}") from exc
        if r.status_code == 429:
            raise LLMError("rate_limited", f"{self.name} 429")
        if r.status_code in (500, 502, 503, 529):
            raise LLMError("overloaded", f"{self.name} {r.status_code}")
        if r.status_code >= 400:
            raise LLMError("bad_request" if r.status_code == 400 else "api_error", f"{self.name} {r.status_code}: {r.text[:300]}")
        _ = loop
        return r.json()

    async def turn(self, *, model, system, messages, tools, max_tokens, effort, on_text, first_token_s, deadline):
        if self._client is None:
            raise LLMError("no_key", f"{self.name}: no API key")
        body: dict[str, Any] = {"model": self.resolve(model), "messages": _to_openai(system, messages),
                                "max_tokens": min(max_tokens, 2048), "temperature": 0.2}
        if tools:
            body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                                "parameters": t["input_schema"]}} for t in tools]
        data = await self._post(body, deadline)
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError) as exc:
            raise LLMError("api_error", f"{self.name}: malformed response") from exc
        text = msg.get("content") or ""
        calls: list[ToolCall] = []
        for c in msg.get("tool_calls") or []:
            try:
                args = json.loads(c["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {"_invalid_json": c["function"].get("arguments")}
            calls.append(ToolCall(c["id"], c["function"]["name"], args))
        await _emit(on_text, text)
        content: list[dict[str, Any]] = ([{"type": "text", "text": text}] if text else []) + [
            {"type": "tool_use", "id": c.id, "name": c.name, "input": c.input} for c in calls]
        return LLMTurn(text, calls, content, "tool_use" if calls else "end_turn", body["model"], data.get("usage") or {})

    async def describe_image(self, *, model, image, media_type, prompt, timeout_s):
        if self._client is None or not self.vision:
            raise LLMError("unavailable", f"{self.name}: no vision model")
        url = f"data:{media_type};base64,{base64.standard_b64encode(image).decode()}"
        body = {"model": self.vision, "max_tokens": 300, "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": url}}]}]}
        data = await self._post(body, asyncio.get_running_loop().time() + timeout_s)
        return data["choices"][0]["message"].get("content") or ""


class ChainLLM:
    """Try providers in order (e.g. Groq then Gemini) within the same deadline; refusals are not retried."""

    def __init__(self, providers: list[Any]) -> None:
        self.providers = [p for p in providers if p.available]
        self.name = ">".join(p.name for p in self.providers) or "none"
        self.last_used: str | None = None

    @property
    def available(self) -> bool:
        return bool(self.providers)

    async def turn(self, **kw):
        last: LLMError | None = None
        for p in self.providers:
            try:
                out = await p.turn(**kw)
                self.last_used = p.name
                return out
            except LLMError as exc:
                last = exc
                if exc.code in ("refusal", "total_timeout"):
                    break
        raise last or LLMError("no_key", "no LLM provider configured")

    async def describe_image(self, **kw):
        last: LLMError | None = None
        for p in self.providers:
            try:
                return await p.describe_image(**kw)
            except LLMError as exc:
                last = exc
        raise last or LLMError("unavailable")


def build_llm() -> Any:
    """LLM_PROVIDER=auto (default): Groq -> Gemini -> Anthropic, whichever have keys."""
    from copilot.agent.llm import AnthropicLLM

    order = os.environ.get("LLM_PROVIDER", "auto").lower()
    names = ["groq", "gemini", "anthropic"] if order == "auto" else [n.strip() for n in order.split(",")]
    built = [AnthropicLLM() if n == "anthropic" else OpenAICompatLLM(n) for n in names if n in (*PROVIDERS, "anthropic")]
    return ChainLLM(built)
