"""Site geometry: zones, haul road, V2I nodes and local<->geo conversion.

Local frame: x east, y north, metres.  Origin (0,0) = ORIGIN_LAT/ORIGIN_LON.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from .config import (
    METRES_PER_DEG_LAT,
    ORIGIN_LAT,
    ORIGIN_LON,
    SITE_X_MAX,
    SITE_Y_MAX,
)

_METRES_PER_DEG_LON = METRES_PER_DEG_LAT * math.cos(math.radians(ORIGIN_LAT))


def to_latlon(x: float, y: float) -> tuple[float, float]:
    """Local metres -> (lat, lon)."""
    return (
        round(ORIGIN_LAT + y / METRES_PER_DEG_LAT, 6),
        round(ORIGIN_LON + x / _METRES_PER_DEG_LON, 6),
    )


def clamp_to_site(x: float, y: float) -> tuple[float, float]:
    return min(max(x, 0.0), SITE_X_MAX), min(max(y, 0.0), SITE_Y_MAX)


@dataclass(frozen=True)
class Zone:
    zone_id: str
    label: str
    x0: float
    y0: float
    x1: float
    y1: float

    def contains(self, x: float, y: float) -> bool:
        return self.x0 <= x <= self.x1 and self.y0 <= y <= self.y1

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.x0 + self.x1) / 2, (self.y0 + self.y1) / 2)

    def random_point(self, rng: random.Random, margin: float = 5.0) -> tuple[float, float]:
        return (
            rng.uniform(self.x0 + margin, self.x1 - margin),
            rng.uniform(self.y0 + margin, self.y1 - margin),
        )


ZONES: tuple[Zone, ...] = (
    Zone("A", "Excavation", 40, 180, 140, 280),
    Zone("B", "Trenching", 160, 180, 260, 280),
    Zone("C", "Grading / Stockpile", 280, 180, 380, 280),
)

HAUL_ROAD: tuple[tuple[float, float], ...] = (
    (20, 100), (200, 100), (380, 100), (380, 170),
)

LOADER_POINT = (300.0, 150.0)
DUMP_AREA = (40.0, 40.0)
STOCKPILE = (340.0, 165.0)


@dataclass(frozen=True)
class V2INode:
    node_id: str
    node_type: str           # fuel_bay | gate | loader_queue
    label: str
    x: float
    y: float


V2I_NODES: tuple[V2INode, ...] = (
    V2INode("N-FUEL", "fuel_bay", "Fuel bay", 200.0, 30.0),
    V2INode("N-GATE", "gate", "Site gate", 0.0, 100.0),
    V2INode("N-LOADQ", "loader_queue", "Loader queue", LOADER_POINT[0], LOADER_POINT[1]),
)


def zone_of(x: float, y: float) -> str:
    for z in ZONES:
        if z.contains(x, y):
            return z.zone_id
    if y < 130:
        return "road"
    return "yard"


def zone_by_id(zone_id: str) -> Zone:
    for z in ZONES:
        if z.zone_id == zone_id:
            return z
    return ZONES[0]


def road_point(t: float) -> tuple[float, float]:
    """Point at normalised distance t in [0,1] along the haul road polyline."""
    segs = []
    total = 0.0
    for a, b in zip(HAUL_ROAD, HAUL_ROAD[1:]):
        d = math.dist(a, b)
        segs.append((a, b, d))
        total += d
    target = (t % 1.0) * total
    run = 0.0
    for a, b, d in segs:
        if run + d >= target:
            f = (target - run) / d if d else 0.0
            return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
        run += d
    return HAUL_ROAD[-1]


def road_length() -> float:
    return sum(math.dist(a, b) for a, b in zip(HAUL_ROAD, HAUL_ROAD[1:]))


SITE_LAYOUT: dict = {
    "bounds": {"x_max": SITE_X_MAX, "y_max": SITE_Y_MAX},
    "origin": {"lat": ORIGIN_LAT, "lon": ORIGIN_LON},
    "metres_per_deg": {"lat": METRES_PER_DEG_LAT, "lon": round(_METRES_PER_DEG_LON, 2)},
    "zones": [
        {
            "zone_id": z.zone_id, "label": z.label,
            "x0": z.x0, "y0": z.y0, "x1": z.x1, "y1": z.y1,
        }
        for z in ZONES
    ],
    "roads": [{"road_id": "HAUL", "label": "Haul road", "points": [list(p) for p in HAUL_ROAD]}],
    "points_of_interest": [
        {"id": "LOADER", "label": "Loader point", "x": LOADER_POINT[0], "y": LOADER_POINT[1]},
        {"id": "DUMP", "label": "Dump area", "x": DUMP_AREA[0], "y": DUMP_AREA[1]},
        {"id": "STOCKPILE", "label": "Stockpile", "x": STOCKPILE[0], "y": STOCKPILE[1]},
    ],
    "v2i_nodes": [
        {"node_id": n.node_id, "node_type": n.node_type, "label": n.label, "x": n.x, "y": n.y}
        for n in V2I_NODES
    ],
}


# --- haul routes ----------------------------------------------------------
# A one-way circulation loop, as a real haul road is laid out.  Loaded trucks
# run loader -> dump down the north lane (y=118) and round the west end; empty
# trucks return along the south lane (y=82).  The lanes never cross except at
# the loader and dump themselves, so routine haul traffic does not trip the
# V2V conflict rule - only genuinely unplanned conflicts do.

LOADED_ROUTE: tuple[tuple[float, float], ...] = (
    LOADER_POINT, (210, 118), (60, 118), (30, 118), (30, 50), DUMP_AREA,
)
EMPTY_ROUTE: tuple[tuple[float, float], ...] = (
    DUMP_AREA, (55, 20), (200, 82), (345, 82), (365, 110), LOADER_POINT,
)


def lane_separation_min() -> float:
    """Smallest gap between the two lanes outside the service points.

    Used by the contract test to guarantee routine haul traffic never trips
    the V2V conflict rule.
    """
    def samples(route):
        pts = []
        for a, b in zip(route, route[1:]):
            for i in range(21):
                f = i / 20
                pts.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
        return pts

    service = (LOADER_POINT, DUMP_AREA)
    best = float("inf")
    for pa in samples(LOADED_ROUTE):
        if any(math.dist(pa, sp) < 30 for sp in service):
            continue
        for pb in samples(EMPTY_ROUTE):
            if any(math.dist(pb, sp) < 30 for sp in service):
                continue
            best = min(best, math.dist(pa, pb))
    return round(best, 1)
