"""Ground workers - simulated UWB tags doing a waypoint random walk."""

from __future__ import annotations

import math
import random

from .config import WORKER_IDS
from .site import ZONES, Zone, clamp_to_site, to_latlon, zone_of

WALK_SPEED_MPS = 1.2
WAYPOINT_REACHED_M = 2.0
# trained ground crew keep out of a machine's working envelope; they only end
# up inside it when something goes wrong (or a scenario puts them there)
STANDOFF_M = 14.0
STANDOFF_PUSH = 1.6


class Worker:
    def __init__(self, worker_id: str, zone: Zone, rng: random.Random) -> None:
        self.worker_id = worker_id
        self.rng = rng
        self.home = zone
        self.x, self.y = zone.random_point(rng)
        self.target_x, self.target_y = zone.random_point(rng)
        self.pause_s = 0.0
        # when a scenario pins a worker somewhere, normal walking is suspended
        self.pinned_until_tick: int | None = None

    # -- simulation --------------------------------------------------------
    def tick(self, tick_no: int, dt: float = 1.0, machines=()) -> None:
        if self.pinned_until_tick is not None:
            if tick_no < self.pinned_until_tick:
                return
            self.pinned_until_tick = None

        if self._avoid(machines, dt):
            return

        if self.pause_s > 0:
            self.pause_s -= dt
            return

        dx, dy = self.target_x - self.x, self.target_y - self.y
        dist = math.hypot(dx, dy)
        if dist < WAYPOINT_REACHED_M:
            self.target_x, self.target_y = self.home.random_point(self.rng)
            self.pause_s = self.rng.uniform(2.0, 8.0)
            return

        step = WALK_SPEED_MPS * dt
        self.x += dx / dist * step
        self.y += dy / dist * step
        self.x, self.y = clamp_to_site(self.x, self.y)

    def _avoid(self, machines, dt: float) -> bool:
        """Step away from any machine that is too close.  True if we moved."""
        push_x = push_y = 0.0
        for m in machines:
            if not m.engine_on:
                continue
            dx, dy = self.x - m.x, self.y - m.y
            d = math.hypot(dx, dy)
            if d >= STANDOFF_M or d < 1e-6:
                continue
            weight = (STANDOFF_M - d) / STANDOFF_M
            push_x += dx / d * weight
            push_y += dy / d * weight
        if push_x == 0.0 and push_y == 0.0:
            return False
        norm = math.hypot(push_x, push_y) or 1.0
        step = WALK_SPEED_MPS * STANDOFF_PUSH * dt
        self.x, self.y = clamp_to_site(
            self.x + push_x / norm * step, self.y + push_y / norm * step
        )
        # having retreated, pick a fresh waypoint rather than walking back in
        self.target_x, self.target_y = self.home.random_point(self.rng)
        return True

    def pin_to(self, x: float, y: float, tick_no: int, duration_s: float) -> None:
        """Scenario hook: drop the worker at a spot and hold them there."""
        self.x, self.y = clamp_to_site(x, y)
        self.pinned_until_tick = tick_no + int(duration_s)

    # -- output ------------------------------------------------------------
    def state(self, ts: str) -> dict:
        lat, lon = to_latlon(self.x, self.y)
        return {
            "type": "worker_state",
            "ts": ts,
            "worker_id": self.worker_id,
            "pos": {"x": round(self.x, 2), "y": round(self.y, 2), "lat": lat, "lon": lon},
            "zone": zone_of(self.x, self.y),
        }


def build_workers(rng: random.Random) -> list[Worker]:
    """Spread the crew across the three working zones."""
    return [
        Worker(wid, ZONES[i % len(ZONES)], rng)
        for i, wid in enumerate(WORKER_IDS)
    ]
