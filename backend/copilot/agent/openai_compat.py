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
import re
from typing import Any

import httpx

from copilot.agent.llm import LLMError, LLMTurn, ToolCall, _emit

PROVIDERS: dict[str, dict[str, Any]] = {
    "groq": {"base": "https://api.groq.com/openai/v1", "key": ("GROQ_API_KEY",),
             "main": "openai/gpt-oss-120b", "fast": "openai/gpt-oss-20b", "vision": "",
             "spare": "qwen/qwen3.8-27b", "stt": "whisper-large-v3-turbo"},
    # Google hands out the key under both names depending on where you copy it from (AI Studio vs gcloud).
    # Google retires pinned Gemini snapshots on a rolling schedule (2.5-flash was pulled
    # for new users in 2026) - the "-latest" aliases point at whatever Google currently
    # considers current, so this entry does not need to be revisited every retirement.
    "gemini": {"base": "https://generativelanguage.googleapis.com/v1beta/openai",
               "key": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
               "main": "gemini-flash-latest", "fast": "gemini-flash-lite-latest", "vision": "gemini-flash-latest",
               "spare": "", "stt": ""},
    # Local llama.cpp `llama-server` (`npm run llm`): offline, keyless, last in the auto chain.
    # It serves whichever GGUF it was started with and ignores the model name. CPU-only here
    # (~10 tok/s), hence the longer client timeout.
    "llamacpp": {"base": os.environ.get("LLAMACPP_BASE_URL", "http://127.0.0.1:8081/v1"),
                 "key": ("LLAMACPP_API_KEY",), "default_key": "local", "timeout": 90.0,
                 "main": "local", "fast": "local", "vision": "", "spare": "", "stt": ""},
}


def _key_from_env(names: tuple[str, ...]) -> str | None:
    """First of the accepted env var names that is set and non-empty."""
    for n in names:
        v = os.environ.get(n)
        if v and v.strip():
            return v.strip()
    return None


_ODD_SPACES = str.maketrans({"\u202f": " ", "\u00a0": " ", "\u2011": "-", "\u2009": " "})
_CITE_TAGS = re.compile(r"\u3010[^\u3011]*\u3011")  # gpt-oss adds 【source】 markers


def _clean(text: str) -> str:
    return _CITE_TAGS.sub("", text.translate(_ODD_SPACES))


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
        self._key = api_key or _key_from_env(cfg["key"]) or cfg.get("default_key")
        self.base = cfg["base"]
        self.models = {"main": main or os.environ.get(f"{provider.upper()}_MODEL", cfg["main"]),
                       "fast": fast or os.environ.get(f"{provider.upper()}_FAST_MODEL", cfg["fast"])}
        self.vision = cfg["vision"]
        # free tiers rate-limit per model, so on a 429 the other models' quotas are still there
        self.spares = [m for m in (self.models["main"], self.models["fast"], cfg["spare"]) if m]
        self.disabled: str | None = None  # set when the key is rejected; the chain then skips us
        self._client = httpx.AsyncClient(timeout=cfg.get("timeout", 20.0)) if self._key else None

    @property
    def available(self) -> bool:
        return self._client is not None and self.disabled is None

    def resolve(self, model: str) -> str:
        return self.models.get(model, model)

    async def _post(self, body: dict[str, Any], deadline: float) -> dict[str, Any]:
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
        if r.status_code in (401, 403) or (r.status_code == 400 and "auth" in r.text.lower() and "key" in r.text.lower()):
            self.disabled = f"{self.name}: API key rejected ({r.status_code})"
            raise LLMError("auth", self.disabled)
        if r.status_code >= 400:
            raise LLMError("bad_request" if r.status_code == 400 else "api_error", f"{self.name} {r.status_code}: {r.text[:300]}")
        return r.json()

    async def turn(self, *, model, system, messages, tools, max_tokens, effort, on_text, first_token_s, deadline):
        if self._client is None:
            raise LLMError("no_key", f"{self.name}: no API key")
        body: dict[str, Any] = {"model": self.resolve(model), "messages": _to_openai(system, messages),
                                "max_tokens": min(max_tokens, 2048), "temperature": 0.2}
        if tools:
            body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t["description"],
                                                                "parameters": t["input_schema"]}} for t in tools]
        order = [body["model"]] + [m for m in self.spares if m != body["model"]]
        for i, m in enumerate(order):
            body["model"] = m
            try:
                data = await self._post(body, deadline)
                break
            except LLMError as exc:
                if exc.code != "rate_limited" or i == len(order) - 1:
                    raise
        try:
            msg = data["choices"][0]["message"]
        except (KeyError, IndexError) as exc:
            raise LLMError("api_error", f"{self.name}: malformed response") from exc
        text = _clean(msg.get("content") or "")
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


    async def transcribe(self, audio: bytes, filename: str, media_type: str, language: str | None,
                         timeout_s: float) -> dict[str, Any]:
        """Speech to text (Groq Whisper): returns {"text", "language"}."""
        stt = PROVIDERS[self.name]["stt"]
        if self._client is None or not stt:
            raise LLMError("unavailable", f"{self.name}: no speech-to-text model")
        data = {"model": stt, "response_format": "verbose_json", "temperature": "0"}
        if language:
            data["language"] = language
        try:
            async with asyncio.timeout(timeout_s):
                r = await self._client.post(f"{self.base}/audio/transcriptions", data=data,
                                            files={"file": (filename, audio, media_type)},
                                            headers={"Authorization": f"Bearer {self._key}"})
        except TimeoutError as exc:
            raise LLMError("total_timeout", f"{self.name} stt deadline reached") from exc
        except httpx.HTTPError as exc:
            raise LLMError("unavailable", f"{self.name} stt: {exc!r}") from exc
        if r.status_code == 429:
            raise LLMError("rate_limited", f"{self.name} stt 429")
        if r.status_code >= 400:
            raise LLMError("api_error", f"{self.name} stt {r.status_code}: {r.text[:200]}")
        body = r.json()
        return {"text": (body.get("text") or "").strip(), "language": body.get("language")}


class ChainLLM:
    """Try providers in order (e.g. Groq then Gemini) within the same deadline; refusals are not retried."""

    def __init__(self, providers: list[Any]) -> None:
        self.all = [p for p in providers if p.available]
        self.last_used: str | None = None

    @property
    def providers(self) -> list[Any]:
        return [p for p in self.all if p.available]  # a provider whose key was rejected drops out

    @property
    def name(self) -> str:
        return ">".join(p.name for p in self.providers) or "none"

    @property
    def disabled(self) -> list[str]:
        return [p.disabled for p in self.all if getattr(p, "disabled", None)]

    @property
    def available(self) -> bool:
        return bool(self.providers)

    async def turn(self, **kw):
        errors: list[LLMError] = []
        for p in self.providers:
            try:
                out = await p.turn(**kw)
                self.last_used = p.name
                return out
            except LLMError as exc:
                errors.append(exc)
                if exc.code in ("refusal", "total_timeout"):
                    break
        if not errors:
            raise LLMError("no_key", "no LLM provider configured")
        # report the most useful failure (a rate limit says more than a later provider's bad key)
        rank = ("refusal", "total_timeout", "rate_limited", "overloaded")
        raise min(errors, key=lambda e: rank.index(e.code) if e.code in rank else len(rank))

    async def transcribe(self, **kw) -> dict[str, Any]:
        last: LLMError | None = None
        for p in self.providers:
            if hasattr(p, "transcribe"):
                try:
                    return await p.transcribe(**kw)
                except LLMError as exc:
                    last = exc
        raise last or LLMError("unavailable", "no speech-to-text provider configured")

    @property
    def stt_available(self) -> bool:
        return any(getattr(p, "name", "") in PROVIDERS and PROVIDERS[p.name]["stt"] for p in self.providers)

    async def describe_image(self, **kw):
        last: LLMError | None = None
        for p in self.providers:
            try:
                return await p.describe_image(**kw)
            except LLMError as exc:
                last = exc
        raise last or LLMError("unavailable")


def build_llm() -> Any:
    """LLM_PROVIDER=auto (default): Groq -> Gemini -> Anthropic, whichever have keys, then local llama.cpp."""
    from copilot.agent.llm import AnthropicLLM

    order = os.environ.get("LLM_PROVIDER", "auto").lower()
    names = ["groq", "gemini", "anthropic", "llamacpp"] if order == "auto" else [n.strip() for n in order.split(",")]
    built = [AnthropicLLM() if n == "anthropic" else OpenAICompatLLM(n) for n in names if n in (*PROVIDERS, "anthropic")]
    return ChainLLM(built)
