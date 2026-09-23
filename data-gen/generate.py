"""Historical synthetic data for CAT Copilot.

    uv run python data-gen/generate.py --days 30 --seed 42

Writes to `data/`.  Everything is seeded, so the same seed gives the same
dataset on every machine.

The point of this file is not to make random numbers - it is to bake in the
*relationships* the models are supposed to rediscover:

  * task time really is driven by volume, weather, soil, skill, congestion and
    machine health (the ground-truth formula in section 9 of the brief);
  * unfastened seatbelts really do co-occur with high idle and near-zero load
    cycles, because the operator has left the seat with the engine running -
    which is exactly the pattern in the sample data we were given.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from simulator.config import (  # noqa: E402
    BASE_RATE,
    DEFAULT_BASE_RATE,
    DIESEL_PRICE_INR,
    FLEET,
    OPERATORS,
    SHIFT_HOURS,
    SHIFT_START_HOUR,
    SKILL_FACTOR,
    SOIL_FACTOR,
    SPECS,
    WEATHER_FACTOR,
)
from simulator.site import ZONES  # noqa: E402

DATA = ROOT / "data"
SOILS = ("sand", "mixed", "clay", "rock")
WEATHERS = ("clear", "clear", "clear", "heat", "wind", "rain", "fog")
TASK_TYPES = {
    "trench": "trenching", "excavate": "trenching", "load": "loading",
    "push": "dozing", "haul": "hauling", "grade": "grading",
}

# a tenth machine that sits in the yard: it is what makes the fleet "9 active
# of 10" and it is the trainee's machine in the historical record
SPARE = ("EXC003", "320", "OP1010", "spare")

ANOMALY_TYPES = (
    "excessive_idling", "seatbelt_violation", "overload",
    "harsh_operation", "temperature_anomaly",
)
ANOMALY_SHIFT_RATE = 0.05

# How often an operator leaves the belt off while idling, and how much idle
# they accumulate.  Without this every operator has identical seatbelt
# compliance and the leaderboard column carries no information.
SKILL_BELT_OFF_PROB = {"novice": 0.55, "intermediate": 0.32, "expert": 0.16}
SKILL_IDLE_SCATTER = {"novice": (7, 14), "intermediate": (4, 10), "expert": (2, 7)}


def base_rate(task_type: str, model: str) -> float:
    return BASE_RATE.get((task_type, model), DEFAULT_BASE_RATE)


def nominal_volume(task_type: str, rng: np.random.Generator) -> float:
    return {
        "trenching": lambda: round(float(rng.uniform(60, 200)), 1),
        "loading": lambda: float(rng.integers(10, 21)),
        "grading": lambda: float(round(rng.uniform(2_000, 6_000), -1)),
        "dozing": lambda: round(float(rng.uniform(150, 400)), 1),
        "hauling": lambda: float(rng.integers(8, 17)),
    }[task_type]()


# --------------------------------------------------------------------------
# reference tables
# --------------------------------------------------------------------------

def build_operators() -> pd.DataFrame:
    rows = []
    for op in OPERATORS:
        certified = ["320", "950"] if op.skill != "novice" else ["320"]
        if op.skill == "expert":
            certified = ["320", "950", "D6", "745", "140"]
        rows.append({
            "operator_id": op.operator_id,
            "name": op.name,
            "skill": op.skill,
            "years_experience": op.years_experience,
            "certified_models": "|".join(certified),
        })
    return pd.DataFrame(rows)


def build_machines(end: datetime) -> pd.DataFrame:
    rows = []
    entries = [(f.machine_id, f.model, f.operator_id) for f in FLEET]
    entries.append(SPARE[:3])
    rng = np.random.default_rng(11)
    for machine_id, model, _operator in entries:
        spec = SPECS[model]
        rows.append({
            "machine_id": machine_id,
            "model": model,
            "machine_type": spec.machine_type,
            "engine_hours_start": round(float(rng.uniform(600, 3_000)), 1),
            "commissioned_date": (end - timedelta(days=int(rng.integers(400, 2_200))))
            .strftime("%Y-%m-%d"),
        })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------
# maintenance: component health declining day by day
# --------------------------------------------------------------------------

def build_maintenance(machines: pd.DataFrame, days: list[datetime],
                      rng: np.random.Generator) -> pd.DataFrame:
    rows = []
    for _, m in machines.iterrows():
        # each component starts somewhere and declines at its own rate
        start = {
            "hydraulic": float(rng.uniform(62, 96)),
            "engine": float(rng.uniform(70, 98)),
            "undercarriage": float(rng.uniform(55, 95)),
        }
        rate = {
            "hydraulic": float(rng.uniform(0.10, 0.45)),
            "engine": float(rng.uniform(0.04, 0.18)),
            "undercarriage": float(rng.uniform(0.06, 0.30)),
        }
        for i, day in enumerate(days):
            noise = rng.normal(0, 0.5, 3)
            hyd = max(5.0, start["hydraulic"] - rate["hydraulic"] * i + noise[0])
            eng = max(5.0, start["engine"] - rate["engine"] * i + noise[1])
            und = max(5.0, start["undercarriage"] - rate["undercarriage"] * i + noise[2])
            # a tired pump runs hotter - this is the link maintenance.py uses
            avg_hyd_temp = 68.0 + (100.0 - hyd) * 0.28 + rng.normal(0, 1.5)
            rows.append({
                "date": day.strftime("%Y-%m-%d"),
                "machine_id": m["machine_id"],
                "hydraulic_health": round(hyd, 1),
                "engine_health": round(eng, 1),
                "undercarriage_health": round(und, 1),
                "avg_hydraulic_temp_c": round(avg_hyd_temp, 1),
                "oil_analysis_index": round(
                    float(np.clip(hyd / 100 * 0.9 + rng.normal(0, 0.04), 0, 1)), 3
                ),
            })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------
# tasks: the ground truth the task-time model has to learn
# --------------------------------------------------------------------------

def actual_time_min(
    volume: float, task_type: str, model: str, weather: str, soil: str,
    skill: str, congestion: float, health: float, rng: np.random.Generator,
) -> float:
    minutes = volume / base_rate(task_type, model) * 60.0
    minutes *= WEATHER_FACTOR[weather]
    minutes *= SOIL_FACTOR[soil]
    minutes *= SKILL_FACTOR[skill]
    minutes *= 1 + 0.30 * congestion
    minutes *= 1 + 0.20 * (1 - health)
    minutes *= float(rng.lognormal(0, 0.08))
    return round(minutes, 1)


def build_tasks(machines: pd.DataFrame, operators: pd.DataFrame,
                maintenance: pd.DataFrame, days: list[datetime],
                rng: np.random.Generator, target_rows: int = 5_000) -> pd.DataFrame:
    op_by_id = operators.set_index("operator_id")
    health_lookup = {
        (r["machine_id"], r["date"]): r["hydraulic_health"] / 100.0
        for _, r in maintenance.iterrows()
    }
    pairs = [(f.machine_id, f.model, f.operator_id, TASK_TYPES[f.role]) for f in FLEET]
    pairs.append((SPARE[0], SPARE[1], SPARE[2], "trenching"))

    per_day = max(1, math.ceil(target_rows / (len(days) * len(pairs))))
    rows = []
    counter = 1
    for day in days:
        day_key = day.strftime("%Y-%m-%d")
        weather = str(rng.choice(WEATHERS))
        temperature = float(np.clip(rng.normal(33, 4), 22, 44))
        visibility = {
            "fog": float(rng.uniform(200, 900)), "rain": float(rng.uniform(300, 2_500)),
        }.get(weather, float(rng.uniform(6_000, 12_000)))
        for machine_id, model, operator_id, task_type in pairs:
            skill = op_by_id.loc[operator_id, "skill"]
            years = float(op_by_id.loc[operator_id, "years_experience"])
            health = health_lookup.get((machine_id, day_key), 0.8)
            for k in range(per_day):
                volume = nominal_volume(task_type, rng)
                soil = str(rng.choice(SOILS, p=[0.2, 0.35, 0.3, 0.15]))
                congestion = float(np.clip(rng.beta(2, 4), 0, 1))
                hour = SHIFT_START_HOUR + (k * SHIFT_HOURS) // max(per_day, 1)
                planned = volume / base_rate(task_type, model) * 60.0
                rows.append({
                    "task_id": f"H-{counter:05d}",
                    "task_type": task_type,
                    "machine_id": machine_id,
                    "machine_model": model,
                    "operator_id": operator_id,
                    "operator_skill": skill,
                    "operator_years": years,
                    "soil": soil,
                    "volume_m3": volume,
                    "weather": weather,
                    "temperature_c": round(temperature, 1),
                    "visibility_m": round(visibility, 0),
                    "site_congestion": round(congestion, 3),
                    "time_of_day": int(hour),
                    "machine_health": round(health, 3),
                    # what the site office wrote down: right formula, no context
                    "estimated_time_min": round(planned * float(rng.uniform(0.85, 1.15)), 1),
                    "actual_time_min": actual_time_min(
                        volume, task_type, model, weather, soil, skill,
                        congestion, health, rng,
                    ),
                })
                counter += 1
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------
# telemetry: one row per machine per minute of every shift
# --------------------------------------------------------------------------

def build_telemetry(machines: pd.DataFrame, operators: pd.DataFrame,
                    maintenance: pd.DataFrame, tasks: pd.DataFrame,
                    days: list[datetime], rng: np.random.Generator,
                    ) -> tuple[pd.DataFrame, pd.DataFrame]:
    op_by_id = operators.set_index("operator_id")
    machine_operator = {f.machine_id: f.operator_id for f in FLEET}
    machine_operator[SPARE[0]] = SPARE[2]
    engine_hours = {
        r["machine_id"]: r["engine_hours_start"] for _, r in machines.iterrows()
    }
    health_lookup = {
        (r["machine_id"], r["date"]): r for _, r in maintenance.iterrows()
    }
    task_by_day = {
        (d, m): g["task_id"].tolist()
        for (d, m), g in tasks.assign(
            _d=[None] * len(tasks)
        ).groupby([pd.Series([None] * len(tasks)), "machine_id"])
    } if False else {}

    minutes_per_shift = SHIFT_HOURS * 60
    frames = []
    labels = []

    for day in days:
        day_key = day.strftime("%Y-%m-%d")
        weather = str(rng.choice(WEATHERS))
        day_tasks = tasks[tasks["weather"] == weather]

        for _, m in machines.iterrows():
            machine_id = m["machine_id"]
            model = m["model"]
            spec = SPECS[model]
            operator_id = machine_operator[machine_id]
            skill = op_by_id.loc[operator_id, "skill"]
            health_row = health_lookup.get((machine_id, day_key))
            hyd_health = (health_row["hydraulic_health"] / 100.0) if health_row is not None else 0.8

            # does this machine-shift carry an injected anomaly?
            anomaly = None
            if rng.random() < ANOMALY_SHIFT_RATE:
                anomaly = str(rng.choice(ANOMALY_TYPES))
                labels.append({
                    "date": day_key, "machine_id": machine_id,
                    "operator_id": operator_id, "anomaly_type": anomaly,
                })

            start = day.replace(hour=SHIFT_START_HOUR, minute=0, second=0, microsecond=0)
            ts = pd.date_range(start, periods=minutes_per_shift, freq="1min")
            n = minutes_per_shift

            # --- the base shift: mostly working, with normal breaks ---------
            idle_flag = np.zeros(n, dtype=bool)
            # scheduled breaks: mid-morning, lunch, mid-afternoon
            for centre, width in ((90, 12), (240, 45), (400, 12)):
                lo = int(np.clip(centre + rng.normal(0, 10), 0, n - 1))
                idle_flag[lo:lo + width] = True
            # scattered short idles
            lo_n, hi_n = SKILL_IDLE_SCATTER[skill]
            for _ in range(int(rng.integers(lo_n, hi_n))):
                lo = int(rng.integers(0, n - 6))
                idle_flag[lo:lo + int(rng.integers(2, 7))] = True

            belt_off = idle_flag & (rng.random(n) < SKILL_BELT_OFF_PROB[skill])

            anomaly_window = None
            if anomaly == "excessive_idling":
                lo = int(rng.integers(30, n - 130))
                anomaly_window = (lo, lo + 120)
                idle_flag[lo:lo + 120] = True
                # idle at least 45 min inside a 2-hour window
                keep = rng.random(120) < 0.80
                idle_flag[lo:lo + 120] = keep
            elif anomaly == "seatbelt_violation":
                lo = int(rng.integers(30, n - 130))
                anomaly_window = (lo, lo + 120)
                # the brief's pattern: out of the seat, engine running
                idle_flag[lo:lo + 120] = rng.random(120) < 0.85
                belt_off[lo:lo + 120] = idle_flag[lo:lo + 120] | (rng.random(120) < 0.6)

            working = ~idle_flag

            # --- coupled per-minute signals ---------------------------------
            cycles_per_min = {
                "excavator": 2.6, "wheel_loader": 1.1, "dozer": 0.5,
                "truck": 0.35, "grader": 1.9,
            }[spec.machine_type] / SKILL_FACTOR[skill]
            load_cycles = np.where(
                working, rng.poisson(cycles_per_min, n), 0
            ).astype(int)

            fuel = np.where(
                working, spec.working_fuel_lph / 60.0, spec.idle_fuel_lph / 60.0
            ) * rng.normal(1.0, 0.06, n)
            fuel = np.clip(fuel, 0.005, None)

            idle_min = idle_flag.astype(float)

            payload = np.where(
                working,
                spec.max_payload_kg * rng.uniform(0.55, 0.85, n),
                0.0,
            )
            if anomaly == "overload":
                lo = int(rng.integers(30, n - 90))
                anomaly_window = anomaly_window or (lo, lo + 60)
                payload[lo:lo + 60] = spec.max_payload_kg * rng.uniform(1.12, 1.30, 60)

            harsh_base = {"novice": 0.18, "intermediate": 0.06, "expert": 0.02}[skill]
            harsh = (rng.random(n) < harsh_base) & working
            if anomaly == "harsh_operation":
                lo = int(rng.integers(30, n - 90))
                anomaly_window = anomaly_window or (lo, lo + 60)
                harsh[lo:lo + 60] = (rng.random(60) < min(0.95, harsh_base * 3.5))

            # hydraulic temperature: load driven, worse on a tired pump
            load_factor = np.where(working, 1.0, 0.2)
            hyd = 58 + 22 * load_factor + (1 - hyd_health) * 18 + rng.normal(0, 1.6, n)
            if anomaly == "temperature_anomaly":
                lo = int(rng.integers(30, n - 120))
                anomaly_window = anomaly_window or (lo, lo + 90)
                hyd[lo:lo + 90] = rng.uniform(96, 108, 90)
            coolant = 84 + 6 * load_factor + rng.normal(0, 1.2, n)

            speed = np.where(working, rng.uniform(0, spec.max_speed_mps * 0.5, n), 0.0)
            pitch = rng.normal(0, 2.4, n)

            eh = engine_hours[machine_id] + np.arange(n) / 60.0
            engine_hours[machine_id] = float(eh[-1])

            pool = day_tasks[day_tasks["machine_id"] == machine_id]["task_id"].tolist()
            if not pool:
                pool = tasks[tasks["machine_id"] == machine_id]["task_id"].tolist()[:3]
            task_ids = [pool[min(int(i / n * len(pool)), len(pool) - 1)] for i in range(n)] \
                if pool else [""] * n

            frames.append(pd.DataFrame({
                "timestamp": ts,
                "machine_id": machine_id,
                "operator_id": operator_id,
                "engine_hours": np.round(eh, 3),
                "fuel_used_l": np.round(fuel, 4),
                "load_cycles": load_cycles,
                "idle_min": idle_min,
                "seatbelt": np.where(belt_off, "Unfastened", "Fastened"),
                "payload_kg": np.round(payload, 0),
                "hydraulic_temp_c": np.round(hyd, 1),
                "coolant_temp_c": np.round(coolant, 1),
                "speed_mps": np.round(speed, 2),
                "pitch_deg": np.round(pitch, 2),
                "harsh_swing": harsh,
                "task_id": task_ids,
                "weather": weather,
            }))

    telemetry = pd.concat(frames, ignore_index=True)
    return telemetry, pd.DataFrame(labels)


# --------------------------------------------------------------------------
# the four rows from the brief, reproduced minute by minute
# --------------------------------------------------------------------------

BRIEF_ROWS = [
    # (start, engine_hours_end, fuel_l, cycles, idle_min, seatbelt, alert)
    ("2025-05-01 08:00:00", 1523.5, 5.2, 12, 30, "Fastened", False),
    ("2025-05-01 10:00:00", 1524.8, 3.8, 2, 55, "Unfastened", True),
    ("2025-05-01 14:00:00", 1526.5, 6.1, 10, 15, "Fastened", False),
    ("2025-05-02 09:00:00", 1530.2, 2.0, 1, 60, "Unfastened", True),
]
BRIEF_WINDOW_MIN = 120


def build_brief_rows(rng: np.random.Generator) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Expand the brief's four sample rows into per-minute telemetry.

    Each row is a 2-hour window for EXC001/OP1001.  We generate 120 minutes
    that aggregate back to exactly the fuel, cycles and idle minutes we were
    given, so the claim "our model flags the rows you gave us" is literally
    true of our own history - not a separate hard-coded table.
    """
    spec = SPECS["320"]
    per_minute = []
    summary = []

    for start_s, eh_end, fuel_l, cycles, idle_min, belt, alert in BRIEF_ROWS:
        start = pd.Timestamp(start_s)
        n = BRIEF_WINDOW_MIN
        ts = pd.date_range(start, periods=n, freq="1min")

        idle_flag = np.zeros(n, dtype=bool)
        idle_flag[:int(idle_min)] = True
        rng.shuffle(idle_flag)
        working = ~idle_flag

        # spread the given load cycles over the working minutes
        cyc = np.zeros(n, dtype=int)
        work_idx = np.flatnonzero(working)
        if cycles and len(work_idx):
            picks = rng.choice(work_idx, size=int(cycles), replace=True)
            for p in picks:
                cyc[p] += 1

        # spread the given fuel so idle minutes burn the idle rate
        weights = np.where(working, spec.working_fuel_lph, spec.idle_fuel_lph).astype(float)
        fuel = weights / weights.sum() * fuel_l

        belt_col = np.full(n, "Fastened", dtype=object)
        if belt == "Unfastened":
            # out of the seat for the idle minutes, which is why idle is high
            belt_col[idle_flag] = "Unfastened"

        eh = eh_end - (n - 1 - np.arange(n)) / 60.0
        payload = np.where(working, spec.max_payload_kg * rng.uniform(0.55, 0.8, n), 0.0)

        per_minute.append(pd.DataFrame({
            "timestamp": ts,
            "machine_id": "EXC001",
            "operator_id": "OP1001",
            "engine_hours": np.round(eh, 3),
            "fuel_used_l": np.round(fuel, 4),
            "load_cycles": cyc,
            "idle_min": idle_flag.astype(float),
            "seatbelt": belt_col,
            "payload_kg": np.round(payload, 0),
            "hydraulic_temp_c": np.round(
                58 + 22 * working + rng.normal(0, 1.5, n), 1),
            "coolant_temp_c": np.round(84 + 6 * working + rng.normal(0, 1.0, n), 1),
            "speed_mps": np.round(np.where(working, rng.uniform(0, 0.8, n), 0.0), 2),
            "pitch_deg": np.round(rng.normal(0, 2.0, n), 2),
            "harsh_swing": (rng.random(n) < 0.06) & working,
            "task_id": "BRIEF",
            "weather": "clear",
        }))

        summary.append({
            "timestamp": start_s,
            "machine_id": "EXC001",
            "operator_id": "OP1001",
            "engine_hours": eh_end,
            "fuel_used_l": fuel_l,
            "load_cycles": cycles,
            "idling_time_min": idle_min,
            "seatbelt_status": belt,
            "safety_alert_triggered": "Yes" if alert else "No",
        })

    return pd.concat(per_minute, ignore_index=True), pd.DataFrame(summary)


# --------------------------------------------------------------------------
# incidents, replay tracks and expert/novice runs
# --------------------------------------------------------------------------

INCIDENT_TYPES = ("proximity", "seatbelt", "tip_over", "v2v", "fatigue")
INCIDENT_SEVERITY = {
    "proximity": "high", "seatbelt": "medium", "tip_over": "critical",
    "v2v": "high", "fatigue": "medium",
}


# Incidents are not spread evenly across the crew: a novice has them several
# times more often than an expert.  Without this the safety leaderboard is pure
# noise and ranks the trainee first.
SKILL_INCIDENT_WEIGHT = {"novice": 3.0, "intermediate": 1.3, "expert": 0.5}


def build_incidents(days: list[datetime], rng: np.random.Generator,
                    count: int = 150) -> pd.DataFrame:
    machine_ids = [f.machine_id for f in FLEET]
    machine_operator = {f.machine_id: f.operator_id for f in FLEET}
    skill_by_operator = {o.operator_id: o.skill for o in OPERATORS}
    weights = np.array([
        SKILL_INCIDENT_WEIGHT[skill_by_operator[machine_operator[m]]] for m in machine_ids
    ])
    weights = weights / weights.sum()

    rows = []
    for i in range(count):
        day = days[int(rng.integers(0, len(days)))]
        ts = day.replace(
            hour=int(rng.integers(SHIFT_START_HOUR, SHIFT_START_HOUR + SHIFT_HOURS)),
            minute=int(rng.integers(0, 60)), second=0, microsecond=0,
        )
        machine_id = str(rng.choice(machine_ids, p=weights))
        itype = str(rng.choice(INCIDENT_TYPES, p=[0.38, 0.24, 0.10, 0.18, 0.10]))
        zone = ZONES[int(rng.integers(0, len(ZONES)))]
        x, y = zone.random_point(_RngShim(rng))
        rows.append({
            "incident_id": f"INC-{i + 1:04d}",
            "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "machine_id": machine_id,
            "operator_id": machine_operator[machine_id],
            "type": itype,
            "severity": INCIDENT_SEVERITY[itype],
            "x": round(x, 1),
            "y": round(y, 1),
            "zone": zone.zone_id,
            "weather": str(rng.choice(WEATHERS)),
            "description": {
                "proximity": "Ground worker entered the machine's red zone",
                "seatbelt": "Operated with seatbelt unfastened",
                "tip_over": "Stability margin fell below the safe limit",
                "v2v": "Two machines on converging paths",
                "fatigue": "Operator showed signs of fatigue",
            }[itype],
        })
    return pd.DataFrame(rows)


class _RngShim:
    """Adapt numpy Generator to the `random.Random` interface Zone expects."""

    def __init__(self, rng: np.random.Generator) -> None:
        self._rng = rng

    def uniform(self, a: float, b: float) -> float:
        return float(self._rng.uniform(a, b))


def build_incident_tracks(incidents: pd.DataFrame, rng: np.random.Generator,
                          count: int = 4) -> list[dict]:
    """60-second frame-by-frame tracks for the replay library."""
    tracks = []
    picks = incidents[incidents["type"].isin(["proximity", "v2v"])].head(count)
    for _, inc in picks.iterrows():
        frames = []
        mx, my = float(inc["x"]), float(inc["y"])
        # worker walks in from 25 m away and reaches the machine at t=45
        wx, wy = mx + 25.0, my + 12.0
        for t in range(61):
            f = min(t / 45.0, 1.0)
            frames.append({
                "t": t,
                "machines": [{
                    "machine_id": inc["machine_id"],
                    "x": round(mx + math.sin(t / 9) * 1.4, 2),
                    "y": round(my + math.cos(t / 9) * 1.4, 2),
                    "heading_deg": round((t * 4) % 360, 1),
                    "intent": "swing_left" if t % 20 < 10 else "dig",
                    "bubble": "red" if t > 42 else ("amber" if t > 33 else "green"),
                }],
                "workers": [{
                    "worker_id": "W03",
                    "x": round(wx + (mx + 2.5 - wx) * f, 2),
                    "y": round(wy + (my + 2.0 - wy) * f, 2),
                }],
            })
        tracks.append({
            "incident_id": inc["incident_id"],
            "machine_id": inc["machine_id"],
            "operator_id": inc["operator_id"],
            "type": inc["type"],
            "severity": inc["severity"],
            "timestamp": inc["timestamp"],
            "duration_s": 60,
            "frames": frames,
        })
    return tracks


def build_runs(rng: np.random.Generator) -> dict[str, dict]:
    """Expert vs novice doing the same trenching task, for A's ghost feature."""
    runs = {}
    for label, cycle_s, wobble in (("expert", 19.0, 0.4), ("novice", 26.0, 1.8)):
        frames = []
        total_s = 180
        for t in range(total_s):
            phase = (t % cycle_s) / cycle_s
            boom = 35 - 20 * math.sin(phase * math.pi)
            swing = 90 * (1 - math.cos(phase * 2 * math.pi)) / 2
            frames.append({
                "t": t,
                "boom_angle_deg": round(boom + rng.normal(0, wobble), 1),
                "stick_angle_deg": round(-20 - 12 * math.sin(phase * math.pi)
                                         + rng.normal(0, wobble), 1),
                "swing_angle_deg": round(swing + rng.normal(0, wobble * 2), 1),
                "payload_kg": round(2_500 * 0.75 * max(0.0, math.sin(phase * math.pi)), 0),
                "cycle_index": int(t // cycle_s),
            })
        runs[label] = {
            "run_id": f"RUN-{label.upper()}",
            "operator_id": "OP1002" if label == "expert" else "OP1010",
            "skill": label,
            "machine_id": "EXC001",
            "task_type": "trenching",
            "duration_s": total_s,
            "cycles": int(total_s // cycle_s),
            "cycle_time_s": cycle_s,
            "frames": frames,
        }
    return runs


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Generate CAT Copilot historical data")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--tasks", type=int, default=5_000)
    ap.add_argument("--out", type=Path, default=DATA)
    args = ap.parse_args(argv)

    rng = np.random.default_rng(args.seed)
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    (out / "incident_tracks").mkdir(exist_ok=True)
    (out / "runs").mkdir(exist_ok=True)

    end = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    days = [end - timedelta(days=d) for d in range(args.days - 1, -1, -1)]

    print(f"generating {args.days} days, seed {args.seed} -> {out}")

    operators = build_operators()
    machines = build_machines(end)
    maintenance = build_maintenance(machines, days, rng)
    tasks = build_tasks(machines, operators, maintenance, days, rng, args.tasks)
    telemetry, labels = build_telemetry(machines, operators, maintenance, tasks, days, rng)
    brief_minutes, brief_summary = build_brief_rows(rng)
    telemetry = pd.concat([brief_minutes, telemetry], ignore_index=True)
    telemetry = telemetry.sort_values(["timestamp", "machine_id"]).reset_index(drop=True)

    incidents = build_incidents(days, rng)
    tracks = build_incident_tracks(incidents, rng)
    runs = build_runs(rng)

    operators.to_csv(out / "operators.csv", index=False)
    machines.to_csv(out / "machines.csv", index=False)
    maintenance.to_csv(out / "maintenance.csv", index=False)
    tasks.to_csv(out / "tasks.csv", index=False)
    telemetry.to_csv(out / "telemetry.csv", index=False)
    labels.to_csv(out / "anomaly_labels.csv", index=False)
    incidents.to_csv(out / "incidents.csv", index=False)
    brief_summary.to_csv(out / "brief_sample.csv", index=False)

    for track in tracks:
        (out / "incident_tracks" / f"{track['incident_id']}.json").write_text(
            json.dumps(track, indent=1)
        )
    for label, run in runs.items():
        (out / "runs" / f"{label}_run.json").write_text(json.dumps(run, indent=1))

    meta = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "seed": args.seed,
        "days": args.days,
        "diesel_price_inr": DIESEL_PRICE_INR,
        "rows": {
            "operators": len(operators), "machines": len(machines),
            "maintenance": len(maintenance), "tasks": len(tasks),
            "telemetry": len(telemetry), "incidents": len(incidents),
            "injected_anomalies": len(labels),
            "incident_tracks": len(tracks), "runs": len(runs),
        },
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2))

    for name, count in meta["rows"].items():
        print(f"  {name:20s} {count:>8,}")
    print(f"  brief rows verified   {len(brief_summary)} windows -> telemetry.csv")


if __name__ == "__main__":
    main()
