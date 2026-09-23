"""LLM port: one streamed assistant turn with tools.

`AnthropicLLM` wraps the async Anthropic SDK (beta Messages stream: needed for server-side refusal
`fallbacks`). `FakeLLM` is the scripted double every test uses; tests never reach the network.

Timeouts (P2_SPEC §1): first token 5 s (= the model has started a content block of any kind:
thinking, text or tool_use), total 20 s per assistant request (the loop passes an absolute deadline
shared by all rounds). The SDK's own retries are off (`max_retries=0`): on failure the agent loop
falls back to cached/deterministic answers rather than stacking hidden retries past the deadline.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

DEFAULT_MODEL = "claude-opus-5"
DEFAULT_FAST_MODEL = "claude-haiku-4-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
#: models that accept `fallbacks: "default"` (server-side refusal fallback)
FALLBACK_MODELS = {"claude-opus-5", "claude-opus-5-5", "claude-fable-5-1"}

TextSink = Callable[[str], Awaitable[None] | None]


class LLMError(Exception):
    """code: first_token_timeout | total_timeout | overloaded | rate_limited | refusal | unavailable |
    bad_request | api_error | no_key"""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(f"{code}: {message}" if message else code)
        self.code = code


@dataclass
class ToolCall:
    id: str
    name: str
    input: Any


@dataclass
class LLMTurn:
    text: str
    tool_calls: list[ToolCall]
    content: list[dict[str, Any]]  # assistant content to append to history verbatim (thinking blocks included)
    stop_reason: str
    model: str
    usage: dict[str, Any] = field(default_factory=dict)


class LLMPort(Protocol):
    name: str

    @property
    def available(self) -> bool: ...

    async def turn(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        effort: str | None,
        on_text: TextSink | None,
        first_token_s: float,
        deadline: float,
    ) -> LLMTurn: ...


async def _emit(sink: TextSink | None, text: str) -> None:
    if sink is None or not text:
        return
    res = sink(text)
    if asyncio.iscoroutine(res):
        await res


class AnthropicLLM:
    name = "anthropic"

    def __init__(self, api_key: str | None = None) -> None:
        # Credentials: an explicit key, ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, or an `ant auth login`
        # profile (the SDK resolves profiles itself; we only check one exists so health can say "down").
        env_key = api_key or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
        profile = os.environ.get("ANTHROPIC_PROFILE") or (Path.home() / ".config" / "anthropic").is_dir()
        self._client = None
        if env_key or profile:
            import anthropic

            kw = {"api_key": api_key} if api_key else {}
            self._client = anthropic.AsyncAnthropic(max_retries=0, timeout=20.0, **kw)

    @property
    def available(self) -> bool:
        return self._client is not None

    async def turn(self, *, model, system, messages, tools, max_tokens, effort, on_text, first_token_s, deadline):
        if self._client is None:
            raise LLMError("no_key", "no ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or ant auth profile")
        import anthropic

        kwargs: dict[str, Any] = dict(model=model, max_tokens=max_tokens, system=system, messages=messages)
        if tools:
            kwargs["tools"] = [{**t, "eager_input_streaming": True} for t in tools]
        if effort and not model.startswith("claude-haiku"):
            kwargs["output_config"] = {"effort": effort}
        if model in FALLBACK_MODELS:
            kwargs["betas"] = [FALLBACK_BETA]
            kwargs["fallbacks"] = "default"
        loop = asyncio.get_running_loop()
        try:
            async with asyncio.timeout_at(deadline):
                async with self._client.beta.messages.stream(**kwargs) as stream:
                    it = stream.__aiter__()
                    try:
                        async with asyncio.timeout(min(first_token_s, max(0.0, deadline - loop.time()))):
                            while True:
                                event = await it.__anext__()
                                if event.type == "text":
                                    await _emit(on_text, event.text)
                                if event.type == "content_block_start":
                                    break
                    except TimeoutError as exc:
                        raise LLMError("first_token_timeout", f"no content within {first_token_s}s") from exc
                    except StopAsyncIteration:
                        pass
                    async for event in it:
                        if event.type == "text":
                            await _emit(on_text, event.text)
                    final = await stream.get_final_message()
        except LLMError:
            raise
        except TimeoutError as exc:
            raise LLMError("total_timeout", "assistant deadline reached") from exc
        except anthropic.RateLimitError as exc:
            raise LLMError("rate_limited", str(exc)) from exc
        except anthropic.OverloadedError as exc:
            raise LLMError("overloaded", str(exc)) from exc
        except anthropic.BadRequestError as exc:
            raise LLMError("bad_request", str(exc)) from exc
        except anthropic.APIStatusError as exc:
            raise LLMError("overloaded" if exc.status_code == 529 else "api_error", str(exc)) from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError("unavailable", str(exc)) from exc
        if final.stop_reason == "refusal":
            raise LLMError("refusal", str(getattr(final, "stop_details", "") or ""))
        text = "".join(b.text for b in final.content if b.type == "text")
        calls = [ToolCall(b.id, b.name, b.input) for b in final.content if b.type == "tool_use"]
        if final.stop_reason == "max_tokens" and calls:
            raise LLMError("api_error", "tool input truncated at max_tokens")
        return LLMTurn(
            text=text,
            tool_calls=calls,
            content=[b.to_dict() for b in final.content],
            stop_reason=final.stop_reason or "end_turn",
            model=final.model,
            usage=final.usage.to_dict() if final.usage else {},
        )


    async def describe_image(self, *, model: str, image: bytes, media_type: str, prompt: str, timeout_s: float) -> str:
        """Advisory vision call (describe_scene). Never on the safety path."""
        if self._client is None:
            raise LLMError("no_key", "no credentials")
        import base64

        import anthropic

        try:
            async with asyncio.timeout(timeout_s):
                msg = await self._client.messages.create(
                    model=model, max_tokens=300,
                    messages=[{"role": "user", "content": [
                        {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                                     "data": base64.standard_b64encode(image).decode()}},
                        {"type": "text", "text": prompt}]}])
        except TimeoutError as exc:
            raise LLMError("total_timeout", "vision call timed out") from exc
        except anthropic.APIError as exc:
            raise LLMError("api_error", str(exc)) from exc
        if msg.stop_reason == "refusal":
            raise LLMError("refusal")
        return "".join(b.text for b in msg.content if b.type == "text")


# --------------------------------------------------------------------------- test double


@dataclass
class FakeStep:
    """One scripted LLM turn. `tool_calls` are (name, input) pairs."""

    text: str = ""
    tool_calls: list[tuple[str, Any]] = field(default_factory=list)
    error: str | None = None  # raise LLMError(error)
    first_token_delay: float = 0.0
    delay: float = 0.0


class FakeLLM:
    """Scripted LLM (labelled fake). Either a list of FakeSteps consumed in order, or a callable
    `responder(messages, tools, system) -> FakeStep` for routing-style tests."""

    name = "fake"

    def __init__(self, script: list[FakeStep] | Callable[..., FakeStep] | None = None, available: bool = True):
        self._n = 0
        self.script = script if script is not None else []
        self._available = available
        self.calls: list[dict[str, Any]] = []
        self.image_description: str | None = None  # describe_image result (None -> LLMError)

    @property
    def script(self):
        return self._script

    @script.setter
    def script(self, value) -> None:
        self._script = value
        self._n = 0  # a new script starts from its first step

    @property
    def available(self) -> bool:
        return self._available

    async def turn(self, *, model, system, messages, tools, max_tokens, effort, on_text, first_token_s, deadline):
        self.calls.append({"model": model, "system": system, "messages": [dict(m) for m in messages],
                           "tools": [t["name"] for t in tools], "effort": effort})
        if callable(self.script):
            step = self.script(messages, tools, system)
        else:
            if self._n >= len(self.script):
                raise AssertionError(f"FakeLLM script exhausted after {self._n} turns")
            step = self.script[self._n]
        self._n += 1
        loop = asyncio.get_running_loop()
        if step.first_token_delay:
            wait = min(first_token_s, max(0.0, deadline - loop.time()))
            if step.first_token_delay > wait:
                await asyncio.sleep(wait)
                raise LLMError("first_token_timeout" if wait == first_token_s else "total_timeout")
            await asyncio.sleep(step.first_token_delay)
        if step.error:
            raise LLMError(step.error)
        if step.delay:
            if loop.time() + step.delay > deadline:
                await asyncio.sleep(max(0.0, deadline - loop.time()))
                raise LLMError("total_timeout")
            await asyncio.sleep(step.delay)
        for word in step.text.split(" "):
            await _emit(on_text, word + " ")
        calls = [ToolCall(f"toolu_{self._n}_{i}", n, inp) for i, (n, inp) in enumerate(step.tool_calls)]
        content: list[dict[str, Any]] = []
        if step.text:
            content.append({"type": "text", "text": step.text})
        content += [{"type": "tool_use", "id": c.id, "name": c.name, "input": c.input} for c in calls]
        return LLMTurn(step.text, calls, content, "tool_use" if calls else "end_turn", model, {})

    async def describe_image(self, *, model, image, media_type, prompt, timeout_s):
        if self.image_description is None:
            raise LLMError("unavailable", "FakeLLM has no image_description set")
        return self.image_description
