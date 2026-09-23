"""Per-client outbox: reliable messages are never dropped; states coalesce per entity.

Drain order is by `seq`, so each connection sees strictly increasing seq numbers.
"""

from __future__ import annotations

import asyncio
from collections import deque


class Outbox:
    __slots__ = ("_reliable", "_states", "wakeup", "max_reliable", "overflowed", "coalesced")

    def __init__(self, max_reliable: int) -> None:
        self._reliable: deque[tuple[int, str]] = deque()
        # insertion order == seq order because a replaced key is popped and re-inserted
        self._states: dict[str, tuple[int, str]] = {}
        self.wakeup = asyncio.Event()
        self.max_reliable = max_reliable
        self.overflowed = False
        self.coalesced = 0

    def put_reliable(self, seq: int, text: str) -> bool:
        """Queue a reliable message. Returns False (and flags overflow) past the limit."""
        self._reliable.append((seq, text))
        self.wakeup.set()
        if len(self._reliable) > self.max_reliable:
            self.overflowed = True
            return False
        return True

    def put_state(self, key: str, seq: int, text: str) -> None:
        if self._states.pop(key, None) is not None:
            self.coalesced += 1
        self._states[key] = (seq, text)
        self.wakeup.set()

    def clear_states(self) -> None:
        self._states.clear()

    def pending(self) -> tuple[int, int]:
        return len(self._reliable), len(self._states)

    def drain(self) -> list[str]:
        """Everything queued, merged in seq order."""
        out: list[str] = []
        states = list(self._states.values())
        self._states.clear()
        rel = self._reliable
        i = 0
        while rel or i < len(states):
            if rel and (i >= len(states) or rel[0][0] < states[i][0]):
                out.append(rel.popleft()[1])
            else:
                out.append(states[i][1])
                i += 1
        return out
