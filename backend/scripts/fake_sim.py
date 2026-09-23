"""fake_sim: a lightweight, deterministic stand-in for Person C's simulator.   provenance = "fake"

    cd backend && uv run python scripts/fake_sim.py [--url ws://localhost:8000/ws/ingest]

* 10 machines at 1 Hz: C's 9-machine FLEET plus EXC003 (C's history-only spare, operator OP1010).
* 6 workers (W01..W06) at 1 Hz.
* Periodic events from C's catalogue every --event-interval seconds.
* Speaks C's wire format exactly (every frame is validated against `simulator.schemas`), and
  additionally sends `source_hello{kind:"fake", accepts_control:true}` so the hub can route
  director scenarios to it as `control` messages; it answers each with `control_ack`.

It is NOT a physics simulator. Use C's `python -m simulator --mode hub` for the real thing; the hub
prefers `sim` over `fake` automatically when both are connected.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import math
import random
import sys
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import websockets
from intelligence.risk import get_working_risk
from simulator.config import FLEET
from simulator.schemas import Event, MachineState, WorkerState
from simulator.site import DUMP_AREA, EMPTY_ROUTE, LOADED_ROUTE, LOADER_POINT, ZONES, to_latlon

MACHINE_TYPE = {"320": "excavator", "950": "wheel_loader", "D6": "dozer", "745": "truck", "140": "grader"}
ZONE = {z.zone_id: z for z in ZONES}
SCENARIOS = (
    "start_shift", "rain", "unbuckle", "buckle", "worker_behind", "fatigue", "dozer_reversing",
    "heavy_lift", "hydraulic_spike", "idle_anomaly", "loader_queue", "reset",
)


def iso(t: float | None = None) -> str:
    dt = datetime.fromtimestamp(time.time() if t is None else t, tz=UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


@dataclass
class FakeMachine:
    machine_id: str
    model: str
    operator_id: str
    home_zone: str
    x: float
    y: float
    route: list[tuple[float, float]]
    speed: float
    heading: float = 0.0
    wp: int = 0
    engine_hours: float = 1300.0
    fuel: float = 80.0
    fuel_used: float = 0.0
    cycles: int = 0
    idle_min: float = 0.0
    seatbelt: str = "fastened"
    payload: float = 0.0
    hyd_offset: float = 0.0
    fatigue: float = 0.08
    reversing: bool = False
    frozen: bool = False
    tip_override: float | None = None
    faults: list[str] = field(default_factory=list)
    unbuckled_at: float | None = None
    escalation_sent: int = 0

    @property
    def mtype(self) -> str:
        return MACHINE_TYPE[self.model]


class FakeSite:
    def __init__(self, seed: int, machines: int) -> None:
        self.rng = random.Random(seed)
        entries = [(f.machine_id, f.model, f.operator_id, f.home_zone) for f in FLEET]
        entries.append(("EXC003", "320", "OP1010", "A"))
        self.machines: list[FakeMachine] = []
        for mid, model, op, zone in entries[:machines]:
            if zone == "road":
                route = list(LOADED_ROUTE) + list(EMPTY_ROUTE)
                start = route[self.rng.randrange(len(route))]
                speed = 6.0
            else:
                z = ZONE[zone]
                route = [z.random_point(self.rng, 8.0) for _ in range(4)]
                start = route[0]
                speed = 1.2 if MACHINE_TYPE[model] == "excavator" else 2.5
            self.machines.append(
                FakeMachine(mid, model, op, zone, start[0], start[1], route, speed,
                            engine_hours=round(self.rng.uniform(900, 2400), 2),
                            fuel=round(self.rng.uniform(55, 95), 1))
            )
        self.by_id = {m.machine_id: m for m in self.machines}
        self.workers = {
            f"W0{i + 1}": list(ZONES[i % 3].random_point(self.rng, 10.0)) for i in range(6)
        }
        self.pinned: dict[str, tuple[str, float]] = {}  # worker -> (machine, until)
        self.weather = "clear"
        self.n_events = 0
        self.pending_events: list[dict[str, Any]] = []

    # ------------------------------------------------------------------ physics-ish
    def step(self, dt: float, now: float) -> None:
        for m in self.machines:
            if m.frozen:
                m.idle_min += dt / 60
                continue
            tx, ty = m.route[m.wp]
            dx, dy = tx - m.x, ty - m.y
            dist = math.hypot(dx, dy)
            if dist < 1.0:
                m.wp = (m.wp + 1) % len(m.route)
                m.cycles += 1
                if m.mtype == "truck":
                    m.payload = 30000.0 if (tx, ty) == LOADER_POINT else (0.0 if (tx, ty) == DUMP_AREA else m.payload)
                continue
            step = min(dist, m.speed * dt)
            m.x += dx / dist * step
            m.y += dy / dist * step
            m.heading = (math.degrees(math.atan2(dx, dy)) + (180 if m.reversing else 0)) % 360
            burn = 0.004 * dt
            m.fuel = max(0.0, m.fuel - burn)
            m.fuel_used += burn * 4
            m.engine_hours += dt / 3600
            if m.mtype == "excavator":
                m.payload = 800.0 + 600.0 * math.sin(now / 3 + sum(map(ord, m.machine_id)) % 7)
        for wid, pos in self.workers.items():
            pin = self.pinned.get(wid)
            if pin and pin[1] > now:
                m = self.by_id[pin[0]]
                back = math.radians((m.heading + 180) % 360)
                pos[0], pos[1] = m.x + 3.0 * math.sin(back), m.y + 3.0 * math.cos(back)
                continue
            self.pinned.pop(wid, None)
            pos[0] = min(max(pos[0] + self.rng.uniform(-0.6, 0.6), 0), 400)
            pos[1] = min(max(pos[1] + self.rng.uniform(-0.6, 0.6), 0), 300)
        for m in self.machines:
            if m.unbuckled_at is not None and m.seatbelt == "unfastened":
                level = min(3, int((now - m.unbuckled_at) // 5) + 1)
                if level > m.escalation_sent:
                    m.escalation_sent = level
                    self.event("seatbelt_unfastened", "high", m.machine_id, "rules",
                               f"Seatbelt unfastened - escalation level {level} ({m.machine_id})",
                               {"escalation_level": level})

    def nearest_person(self, m: FakeMachine) -> float:
        return min(math.hypot(w[0] - m.x, w[1] - m.y) for w in self.workers.values())

    def machine_state(self, m: FakeMachine, ts: str) -> dict[str, Any]:
        lat, lon = to_latlon(m.x, m.y)
        near = min(self.nearest_person(m), 99.0)
        hyd = 72.0 + m.hyd_offset + 3.0 * math.sin(time.time() / 60)
        zone = next((z.zone_id for z in ZONES if z.contains(m.x, m.y)), "road" if m.y < 130 else "yard")
        moving = not m.frozen
        tip = m.tip_override if m.tip_override is not None else (2.6 if m.mtype == "excavator" else 3.0)
        return {
            "type": "machine_state", "ts": ts, "machine_id": m.machine_id, "model": m.model,
            "machine_type": m.mtype, "operator_id": m.operator_id,
            "status": "working" if moving else "idle",
            "pos": {"x": round(m.x, 2), "y": round(m.y, 2), "lat": lat, "lon": lon},
            "heading_deg": round(m.heading, 1), "speed_mps": round(m.speed if moving else 0.0, 2),
            "intent": "reverse" if m.reversing else ("idle" if not moving else
                      {"excavator": "dig", "truck": "travel_forward", "dozer": "push",
                       "grader": "grade", "wheel_loader": "travel_forward"}[m.mtype]),
            "engine_on": True, "engine_hours": round(m.engine_hours, 2),
            "fuel_level_pct": round(m.fuel, 1), "fuel_used_l": round(m.fuel_used, 2),
            "load_cycles": m.cycles, "idle_min": round(m.idle_min, 1), "seatbelt": m.seatbelt,
            "boom_angle_deg": 30.0, "stick_angle_deg": -20.0, "swing_angle_deg": 0.0,
            "payload_kg": float(round(m.payload)), "hydraulic_temp_c": round(hyd, 1),
            "coolant_temp_c": 88.0, "pitch_deg": 0.5, "roll_deg": 0.1, "tip_over_margin": tip,
            "bubble": "red" if near < 5 else ("amber" if near < 12 else "green"),
            "nearest_person_m": round(near, 1), "fatigue_score": round(m.fatigue, 2),
            "fault_codes": list(m.faults), "zone": zone, "task_id": None,
            "task_progress": 0.0, "task_eta_min": 0.0,
        }

    def worker_state(self, wid: str, ts: str) -> dict[str, Any]:
        x, y = self.workers[wid]
        lat, lon = to_latlon(x, y)
        zone = next((z.zone_id for z in ZONES if z.contains(x, y)), "road" if y < 130 else "yard")
        return {"type": "worker_state", "ts": ts, "worker_id": wid,
                "pos": {"x": round(x, 2), "y": round(y, 2), "lat": lat, "lon": lon}, "zone": zone}

    def event(self, kind: str, severity: str, machine_id: str | None, source: str, message: str,
              data: dict[str, Any]) -> dict[str, Any]:
        self.n_events += 1
        evt = {"type": "event", "id": f"fake_{self.n_events:06d}", "ts": iso(), "event": kind,
               "severity": severity, "machine_id": machine_id, "source": source, "message": message,
               "data": data}
        self.pending_events.append(evt)
        return evt

    # ------------------------------------------------------------------ periodic + scenarios
    def periodic_event(self) -> None:
        m = self.machines[self.rng.randrange(len(self.machines))]
        choice = self.n_events % 4
        if choice == 0:
            self.event("v2i_suggestion", "info", m.machine_id, "v2i", "Loader queue is short - proceed",
                       {"node_id": "N-LOADQ", "node_type": "loader_queue", "suggestion": "proceed", "queue_depth": 1})
        elif choice == 1:
            self.event("anomaly_detected", "medium", m.machine_id, "ml", f"Unusual idling on {m.machine_id}",
                       {"anomaly_type": "excessive_idling", "score": 0.7, "fuel_cost_inr": 90, "window_min": 60})
        elif choice == 2:
            near = round(self.nearest_person(m), 1)
            self.event("proximity_alert", "high", m.machine_id, "simulator",
                       f"Worker {near} m from {m.machine_id}", {"distance_m": near, "zone": "front", "worker_id": "W01"})
        else:
            self.event("maintenance_due", "medium", m.machine_id, "rules", f"Service due on {m.machine_id}",
                       {"component": "engine", "health_pct": 62.0, "hours_to_service": 140})

    def scenario(self, name: str, args: dict[str, Any], now: float) -> None:
        mid = args.get("machine_id", "EXC001")
        if name not in SCENARIOS:
            raise ValueError(f"unknown scenario {name}")
        if name != "reset" and mid not in self.by_id:
            raise ValueError(f"unknown machine {mid}")
        m = self.by_id.get(mid)
        if name == "unbuckle":
            m.seatbelt, m.unbuckled_at, m.escalation_sent = "unfastened", now, 0
        elif name == "buckle":
            m.seatbelt, m.unbuckled_at = "fastened", None
            self.event("seatbelt_fastened", "info", mid, "rules", f"Seatbelt fastened ({mid})", {})
        elif name == "worker_behind":
            self.pinned["W02"] = (mid, now + float(args.get("duration_s", 10)))
            self.event("proximity_alert", "critical", mid, "simulator", f"Worker 3.0 m behind {mid}",
                       {"distance_m": 3.0, "zone": "rear", "worker_id": "W02"})
        elif name == "fatigue":
            m.fatigue = float(args.get("score", 0.85))
            self.event("fatigue_alert", "high", mid, "simulator", f"Operator fatigue on {mid}",
                       {"eyes_closed_s": 2.4, "fatigue_score": m.fatigue})
        elif name == "dozer_reversing":
            d, t = self.by_id[args.get("dozer_id", "DOZ001")], self.by_id[args.get("target_id", "EXC001")]
            d.reversing, d.x, d.y = True, t.x + 22.0, t.y
            path_a = [[round(d.x - i * 1.2, 1), round(d.y, 1)] for i in range(11)]
            path_b = [[round(t.x, 1), round(t.y, 1)] for _ in range(11)]
            self.event("v2v_collision_risk", "high", t.machine_id, "v2v",
                       f"{d.machine_id} reversing toward {t.machine_id}",
                       {"machine_a": t.machine_id, "machine_b": d.machine_id, "time_to_conflict_s": 5.0,
                        "min_distance_m": 8.0, "path_a": path_b, "path_b": path_a})
        elif name == "heavy_lift":
            m.frozen, m.payload, m.tip_override = True, float(args.get("payload_kg", 3200)), 1.11
            self.event("tip_over_warning", "critical", mid, "rules", f"Tip-over margin 1.11 on {mid}",
                       {"margin": 1.11, "payload_kg": m.payload, "slope_deg": float(args.get("slope_deg", 8))})
        elif name == "hydraulic_spike":
            m.hyd_offset = float(args.get("delta_c", 25))
            m.faults = ["HYD-118"]
            self.event("maintenance_due", "medium", mid, "rules", f"Hydraulic temperature high on {mid}",
                       {"component": "hydraulic", "health_pct": 40.0, "hours_to_service": 0})
        elif name == "idle_anomaly":
            e = self.by_id.get(args.get("machine_id", "EXC002"), m)
            e.frozen, e.idle_min = True, float(args.get("idle_min", 50))
            self.event("anomaly_detected", "medium", e.machine_id, "scenario", f"Excessive idling on {e.machine_id}",
                       {"anomaly_type": "excessive_idling", "score": 0.93, "fuel_cost_inr": 450, "window_min": 50})
        elif name == "loader_queue":
            self.event("v2i_suggestion", "info", "TRK001", "v2i", "3 trucks queued at the loader",
                       {"node_id": "N-LOADQ", "node_type": "loader_queue", "suggestion": "hold at gate",
                        "queue_depth": int(args.get("count", 3))})
        elif name == "rain":
            self.weather = "rain"
            self.event("weather_change", "medium", None, "scenario", "Weather changed to rain",
                       {"weather": "rain", "visibility_m": 300, "ground": "wet"})
            risk = get_working_risk(weather="rain", visibility_m=300, ground="wet")
            self.event("working_risk_changed", "medium", None, "scenario", f"Working risk {risk['score']}",
                       {"score": risk["score"], "level": risk["level"], "reasons": risk["reasons"]})
        elif name == "start_shift":
            for x in self.machines:
                x.fuel_used, x.idle_min, x.cycles = 0.0, 0.0, 0
        elif name == "reset":
            for x in self.machines:
                x.seatbelt, x.unbuckled_at, x.hyd_offset, x.faults = "fastened", None, 0.0, []
                x.frozen, x.reversing, x.tip_override, x.fatigue, x.idle_min = False, False, None, 0.08, 0.0
            self.pinned.clear()
            self.weather = "clear"


def validate(frame: dict[str, Any]) -> None:
    model = {"machine_state": MachineState, "worker_state": WorkerState, "event": Event}[frame["type"]]
    model.model_validate(frame)


async def run(args: argparse.Namespace, sent_log) -> int:
    site = FakeSite(args.seed, args.machines)
    period = 1.0 / args.hz
    deadline = time.monotonic() + args.duration if args.duration else None
    next_event = time.monotonic() + args.event_interval if args.event_interval > 0 else math.inf
    validated = False
    backoff = 0.5
    while deadline is None or time.monotonic() < deadline:
        try:
            async with websockets.connect(args.url, max_size=2**22) as ws:
                backoff = 0.5
                await ws.send(json.dumps({"type": "source_hello", "source_id": args.source_id,
                                          "kind": "fake", "format": "contract", "accepts_control": True}))
                print(f"fake_sim: connected to {args.url} ({len(site.machines)} machines)", flush=True)

                async def control_reader() -> None:
                    async for text in ws:
                        msg = json.loads(text)
                        if msg.get("type") != "control":
                            continue
                        try:
                            site.scenario(msg["command"], msg.get("args") or {}, time.time())
                            ack = {"type": "control_ack", "command_id": msg["command_id"], "ok": True}
                        except ValueError as exc:
                            ack = {"type": "control_ack", "command_id": msg["command_id"], "ok": False,
                                   "error": str(exc)}
                        await ws.send(json.dumps(ack))

                reader = asyncio.create_task(control_reader())
                try:
                    last = time.monotonic()
                    while deadline is None or time.monotonic() < deadline:
                        now_m = time.monotonic()
                        site.step(now_m - last, time.time())
                        last = now_m
                        while now_m >= next_event:
                            site.periodic_event()
                            next_event += args.event_interval
                        ts = iso()
                        frames = [site.machine_state(m, ts) for m in site.machines]
                        frames += [site.worker_state(w, ts) for w in site.workers]
                        events, site.pending_events = site.pending_events, []
                        if not validated:
                            for f in frames:
                                validate(f)
                            validated = True
                        for f in frames:
                            await ws.send(json.dumps(f))
                        for e in events:
                            validate(e)
                            e["ts"] = iso()
                            await ws.send(json.dumps(e))
                            if sent_log:
                                sent_log.write(json.dumps({"id": e["id"], "event": e["event"]}) + "\n")
                                sent_log.flush()
                        # events generated between ticks (scenarios) go out on the next loop
                        await asyncio.sleep(max(0.0, period - (time.monotonic() - now_m)))
                finally:
                    reader.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await reader
            return 0
        except (OSError, websockets.ConnectionClosed) as exc:
            print(f"fake_sim: hub unavailable ({exc!r}); retrying in {backoff:.1f}s", flush=True)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 8.0)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default="ws://localhost:8000/ws/ingest")
    p.add_argument("--source-id", default="fake_sim")
    p.add_argument("--machines", type=int, default=10)
    p.add_argument("--hz", type=float, default=1.0)
    p.add_argument("--event-interval", type=float, default=15.0, help="seconds between periodic events (0=off)")
    p.add_argument("--duration", type=float, default=0.0, help="seconds to run (0 = forever)")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--sent-log", default=None, help="write every sent event id here (jsonl)")
    args = p.parse_args()
    sent_log = Path(args.sent_log).open("w") if args.sent_log else None  # noqa: SIM115
    try:
        return asyncio.run(run(args, sent_log))
    finally:
        if sent_log:
            sent_log.close()


if __name__ == "__main__":
    sys.exit(main())
