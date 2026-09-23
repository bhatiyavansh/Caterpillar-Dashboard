"""Ground workers - simulated UWB tags doing a waypoint random walk."""

from __future__ import annotations

import math
import random

from . import config
from .config import (
    WORKER_IDS,
    WORKER_SPOT_DISTANCE_MAX_M,
    WORKER_SPOT_DISTANCE_MIN_M,
    WORKER_SPOT_DURATION_S,
    WORKER_SPOT_INTERVAL_S,
)
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
        # when a scenario pins a worker somewhere, normal walking is suspended.
        # Held in simulated seconds, not ticks, so it survives a rate change.
        self.pinned_until_s: float | None = None

        # spotting assignment
        self.spot_machine: str | None = None
        self.spot_until_s = 0.0
        self.spot_distance_m = WORKER_SPOT_DISTANCE_MAX_M
        self.next_spot_s = rng.uniform(10.0, WORKER_SPOT_INTERVAL_S)

    # -- simulation --------------------------------------------------------
    def tick(self, sim_time_s: float, dt: float = 1.0, machines=()) -> None:
        if self.pinned_until_s is not None:
            if sim_time_s < self.pinned_until_s:
                return
            self.pinned_until_s = None

        # A spotting assignment deliberately overrides the standoff — that is
        # the whole point of the job, and it is what the proximity system is
        # there to watch.
        if self._spot(sim_time_s, dt, machines):
            return

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

    def _spot(self, sim_time_s: float, dt: float, machines) -> bool:
        """Walk out to a working machine and stand by it. True while spotting."""
        # Read through the module so --intensity applies at runtime.
        intensity = max(config.SITE_INTENSITY, 0.01)

        if self.spot_machine is not None and sim_time_s >= self.spot_until_s:
            self.spot_machine = None
            # Gaps shorten as the site gets busier.
            self.next_spot_s = sim_time_s + self.rng.uniform(
                WORKER_SPOT_INTERVAL_S * 0.4, WORKER_SPOT_INTERVAL_S * 1.6
            ) / intensity

        if self.spot_machine is None:
            if sim_time_s < self.next_spot_s:
                return False
            candidates = [m for m in machines if m.engine_on]
            if not candidates:
                return False
            target = self.rng.choice(candidates)
            self.spot_machine = target.machine_id
            self.spot_until_s = sim_time_s + WORKER_SPOT_DURATION_S
            self.spot_distance_m = self.rng.uniform(
                WORKER_SPOT_DISTANCE_MIN_M, WORKER_SPOT_DISTANCE_MAX_M
            )

        machine = next((m for m in machines if m.machine_id == self.spot_machine), None)
        if machine is None or not machine.engine_on:
            self.spot_machine = None
            return False

        # Close to the working distance and hold station there.
        dx, dy = machine.x - self.x, machine.y - self.y
        dist = math.hypot(dx, dy)
        standoff = self.spot_distance_m
        if dist > standoff + 0.5:
            step = min(WALK_SPEED_MPS * dt, dist - standoff)
            self.x += dx / dist * step
            self.y += dy / dist * step
            self.x, self.y = clamp_to_site(self.x, self.y)
        return True

    def pin_to(self, x: float, y: float, until_s: float) -> None:
        """Scenario hook: drop the worker at a spot and hold them there."""
        self.x, self.y = clamp_to_site(x, y)
        self.pinned_until_s = until_s
        # A pinned worker is not also spotting somewhere else.
        self.spot_machine = None

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
