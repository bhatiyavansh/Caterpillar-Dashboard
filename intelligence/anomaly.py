"""Unusual machine usage: deterministic rules first, Isolation Forest second.

Layer 1 catches the patterns the brief names outright (excessive idling,
seatbelt violations, overload, harsh operation, overheating).  Layer 2 catches
what the rules miss, by learning what normal looks like per machine.

C detects; B explains.  `evidence` is what B's LLM needs to write the sentence.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from simulator.config import DIESEL_PRICE_INR, SPECS

DATA = Path(__file__).resolve().parent.parent / "data"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_FILE = MODEL_DIR / "anomaly_iforest.joblib"

# The brief defines its patterns over a 2-hour window ("idle > 45 min in a
# 2-hour window"), and its own sample rows are 2-hour aggregates.  A 30-minute
# window sits entirely inside a lunch break and flags it as excessive idling,
# so the whole layer works at the same 2-hour scale the patterns are stated in.
WINDOW_MIN = 120

# thresholds straight from section 9 of the brief
IDLE_RATIO_HIGH = 0.45
CYCLES_PER_HOUR_LOW = 30.0
OVERLOAD_RATIO = 1.10
HARSH_MULTIPLIER = 3.0
TEMP_HIGH_C = 95.0
SEATBELT_OFF_RATIO = 0.30

FEATURES = [
    "idle_ratio", "fuel_per_cycle", "cycles_per_hour", "mean_payload",
    "harsh_swing_rate", "mean_hydraulic_temp", "seatbelt_off_ratio",
]

_forest = None
_baselines: dict | None = None


# --------------------------------------------------------------------------
# window features
# --------------------------------------------------------------------------

def window_features(rows: pd.DataFrame) -> dict:
    """Collapse a window of per-minute telemetry into the model's features."""
    minutes = max(len(rows), 1)
    cycles = float(rows["load_cycles"].sum())
    fuel = float(rows["fuel_used_l"].sum())
    idle = float(rows["idle_min"].sum())
    belt_off = float((rows["seatbelt"].astype(str).str.lower() == "unfastened").sum())
    harsh = float(rows["harsh_swing"].astype(bool).sum()) if "harsh_swing" in rows else 0.0
    return {
        "idle_ratio": idle / minutes,
        "fuel_per_cycle": fuel / cycles if cycles > 0 else fuel * 10.0,
        "cycles_per_hour": cycles / minutes * 60.0,
        "mean_payload": float(rows["payload_kg"].mean()) if "payload_kg" in rows else 0.0,
        "harsh_swing_rate": harsh / minutes,
        "mean_hydraulic_temp": float(rows["hydraulic_temp_c"].mean())
        if "hydraulic_temp_c" in rows else 0.0,
        "seatbelt_off_ratio": belt_off / minutes,
        # carried along for evidence, not used as model features
        "_idle_min": idle,
        "_load_cycles": int(cycles),
        "_seatbelt_off_min": belt_off,
        "_fuel_l": fuel,
        "_minutes": minutes,
    }


def _rules(feat: dict, max_payload_kg: float, harsh_baseline: float) -> list[str]:
    """Which named patterns fired in this window."""
    fired = []
    # idling most of the window while barely producing anything
    if feat["idle_ratio"] > IDLE_RATIO_HIGH and feat["cycles_per_hour"] < CYCLES_PER_HOUR_LOW:
        fired.append("excessive_idling")
    if feat["seatbelt_off_ratio"] > SEATBELT_OFF_RATIO:
        fired.append("seatbelt_violation")
    if max_payload_kg and feat["mean_payload"] > max_payload_kg * OVERLOAD_RATIO:
        fired.append("overload")
    if harsh_baseline > 0 and feat["harsh_swing_rate"] > harsh_baseline * HARSH_MULTIPLIER:
        fired.append("harsh_operation")
    if feat["mean_hydraulic_temp"] > TEMP_HIGH_C:
        fired.append("temperature_anomaly")
    return fired


def _fuel_wasted_l(feat: dict, model: str) -> float:
    """Diesel burned while idling - the number the owner screen cares about."""
    spec = SPECS.get(model)
    idle_rate = spec.idle_fuel_lph if spec else 4.0
    return round(feat["_idle_min"] / 60.0 * idle_rate, 1)


# --------------------------------------------------------------------------
# model layer
# --------------------------------------------------------------------------

def _load_forest():
    global _forest, _baselines
    if _forest is not None:
        return _forest, _baselines
    if not MODEL_FILE.exists():
        return None, None
    import joblib

    bundle = joblib.load(MODEL_FILE)
    _forest = bundle["model"]
    _baselines = bundle.get("baselines", {})
    return _forest, _baselines


def _score(feat: dict) -> float:
    """Isolation Forest score, normalised to 0-1 (1 = most anomalous)."""
    forest, _ = _load_forest()
    if forest is None:
        return 0.0
    x = np.array([[feat[f] for f in FEATURES]], dtype=float)
    raw = float(forest.score_samples(x)[0])
    # score_samples is roughly -0.75 (very anomalous) .. -0.35 (normal)
    return float(np.clip((-raw - 0.35) / 0.35, 0.0, 1.0))


def _largest_deviation(feat: dict, baseline: dict | None) -> str:
    if not baseline:
        return "unusual_pattern"
    worst, worst_z = "unusual_pattern", 0.0
    for f in FEATURES:
        mean = baseline.get(f, {}).get("mean")
        std = baseline.get(f, {}).get("std") or 1e-6
        if mean is None:
            continue
        z = abs((feat[f] - mean) / std)
        if z > worst_z:
            worst, worst_z = f, z
    return {
        "idle_ratio": "excessive_idling",
        "seatbelt_off_ratio": "seatbelt_violation",
        "mean_payload": "overload",
        "harsh_swing_rate": "harsh_operation",
        "mean_hydraulic_temp": "temperature_anomaly",
        "fuel_per_cycle": "low_productivity",
        "cycles_per_hour": "low_productivity",
    }.get(worst, "unusual_pattern")


# --------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------

def _iso(ts) -> str:
    return pd.Timestamp(ts).strftime("%Y-%m-%dT%H:%M:%SZ")


def analyse_windows(telemetry: pd.DataFrame, window_min: int = WINDOW_MIN) -> list[dict]:
    """Score every window of a telemetry frame.  Shared by history and live."""
    _, baselines = _load_forest()
    machines = pd.read_csv(DATA / "machines.csv") if (DATA / "machines.csv").exists() else None
    model_by_machine = (
        dict(zip(machines["machine_id"], machines["model"])) if machines is not None else {}
    )

    out: list[dict] = []
    telemetry = telemetry.copy()
    telemetry["timestamp"] = pd.to_datetime(telemetry["timestamp"])
    telemetry["_window"] = telemetry["timestamp"].dt.floor(f"{window_min}min")

    counter = 0
    for (machine_id, window), rows in telemetry.groupby(["machine_id", "_window"]):
        if len(rows) < window_min // 2:
            continue
        feat = window_features(rows)
        model = model_by_machine.get(machine_id, "320")
        spec = SPECS.get(model)
        baseline = (baselines or {}).get(machine_id, {})
        harsh_baseline = baseline.get("harsh_swing_rate", {}).get("mean", 0.06)

        fired = _rules(feat, spec.max_payload_kg if spec else 0.0, harsh_baseline)
        score = _score(feat)
        if not fired and score < 0.55:
            continue

        counter += 1
        primary = fired[0] if fired else _largest_deviation(feat, baseline)
        wasted = _fuel_wasted_l(feat, model)
        out.append({
            "anomaly_id": f"AN-{counter:04d}",
            "machine_id": machine_id,
            "operator_id": str(rows["operator_id"].iloc[0]),
            "type": primary,
            "related": [f for f in fired[1:]] + (
                ["low_productivity"] if feat["cycles_per_hour"] < 30 else []
            ),
            "score": round(max(score, 0.75 if fired else score), 2),
            "detected_by": "rules" if fired else "isolation_forest",
            "window": {"start": _iso(window),
                       "end": _iso(window + timedelta(minutes=window_min))},
            "evidence": {
                "idle_min": round(feat["_idle_min"], 1),
                "load_cycles": feat["_load_cycles"],
                "seatbelt_off_min": round(feat["_seatbelt_off_min"], 1),
                "mean_payload_kg": round(feat["mean_payload"], 0),
                "mean_hydraulic_temp_c": round(feat["mean_hydraulic_temp"], 1),
                "baseline_idle_min": round(
                    baseline.get("idle_ratio", {}).get("mean", 0.2) * window_min, 1
                ),
            },
            "fuel_wasted_l": wasted,
            "fuel_cost_inr": round(wasted * DIESEL_PRICE_INR),
        })
    return out


def get_anomalies(machine_id: str | None = None, since_hours: int = 24) -> list[dict]:
    """Anomalies from the historical record, most anomalous first."""
    path = DATA / "telemetry.csv"
    if not path.exists():
        return []
    telemetry = pd.read_csv(path, parse_dates=["timestamp"])
    if machine_id:
        telemetry = telemetry[telemetry["machine_id"] == machine_id]
    if telemetry.empty:
        return []

    latest = telemetry["timestamp"].max()
    cutoff = latest - timedelta(hours=since_hours)
    recent = telemetry[telemetry["timestamp"] >= cutoff]
    if recent.empty:
        recent = telemetry

    found = analyse_windows(recent)
    found.sort(key=lambda a: (-a["score"], a["window"]["start"]))
    return found


def score_live_window(states: list[dict]) -> dict | None:
    """Score one machine's last ~60 seconds of live `machine_state` messages.

    The simulator calls this once a minute per machine.  Live states carry
    cumulative counters, so they are differenced into per-window totals first.
    """
    if len(states) < 10:
        return None

    first, last = states[0], states[-1]
    minutes = max(len(states) / 60.0, 1 / 60)
    idle_min = max(0.0, float(last["idle_min"]) - float(first["idle_min"]))
    cycles = max(0, int(last["load_cycles"]) - int(first["load_cycles"]))
    fuel = max(0.0, float(last["fuel_used_l"]) - float(first["fuel_used_l"]))
    belt_off = sum(1 for s in states if s["seatbelt"] == "unfastened")

    feat = {
        "idle_ratio": min(idle_min / minutes, 1.0),
        "fuel_per_cycle": fuel / cycles if cycles else fuel * 10.0,
        "cycles_per_hour": cycles / minutes * 60.0,
        "mean_payload": float(np.mean([s["payload_kg"] for s in states])),
        "harsh_swing_rate": 0.0,
        "mean_hydraulic_temp": float(np.mean([s["hydraulic_temp_c"] for s in states])),
        "seatbelt_off_ratio": belt_off / len(states),
        "_idle_min": idle_min,
        "_load_cycles": cycles,
        "_seatbelt_off_min": belt_off / 60.0,
        "_fuel_l": fuel,
        "_minutes": minutes,
    }

    model = str(last.get("model", "320"))
    spec = SPECS.get(model)
    fired = _rules(feat, spec.max_payload_kg if spec else 0.0, 0.06)
    score = _score(feat)
    if not fired and score < 0.6:
        return None

    wasted = _fuel_wasted_l(feat, model)
    return {
        "machine_id": last["machine_id"],
        "operator_id": last["operator_id"],
        "type": fired[0] if fired else "unusual_pattern",
        "related": fired[1:],
        "score": round(max(score, 0.75 if fired else score), 2),
        "detected_by": "rules" if fired else "isolation_forest",
        "evidence": {
            "idle_min": round(idle_min, 1),
            "load_cycles": cycles,
            "seatbelt_off_s": belt_off,
        },
        "fuel_wasted_l": wasted,
        "fuel_cost_inr": round(wasted * DIESEL_PRICE_INR),
    }


def score_brief_sample() -> list[dict]:
    """Score the exact four rows from the brief.

    They are 2-hour aggregate windows, so they are scored as pre-aggregated
    windows rather than re-derived from per-minute data.  Used on the pitch
    slide: "our model flags the rows you gave us."
    """
    path = DATA / "brief_sample.csv"
    if not path.exists():
        return []
    rows = pd.read_csv(path)
    out = []
    for _, r in rows.iterrows():
        minutes = 120.0
        feat = {
            "idle_ratio": float(r["idling_time_min"]) / minutes,
            "fuel_per_cycle": float(r["fuel_used_l"]) / max(int(r["load_cycles"]), 1),
            "cycles_per_hour": int(r["load_cycles"]) / minutes * 60.0,
            "mean_payload": 1_500.0,
            "harsh_swing_rate": 0.0,
            "mean_hydraulic_temp": 78.0,
            "seatbelt_off_ratio": (
                float(r["idling_time_min"]) / minutes
                if str(r["seatbelt_status"]).lower() == "unfastened" else 0.0
            ),
            "_idle_min": float(r["idling_time_min"]),
            "_load_cycles": int(r["load_cycles"]),
            "_seatbelt_off_min": (
                float(r["idling_time_min"])
                if str(r["seatbelt_status"]).lower() == "unfastened" else 0.0
            ),
            "_fuel_l": float(r["fuel_used_l"]),
            "_minutes": minutes,
        }
        fired = _rules(feat, SPECS["320"].max_payload_kg, 0.06)
        out.append({
            "timestamp": str(r["timestamp"]),
            "machine_id": str(r["machine_id"]),
            "expected_alert": str(r["safety_alert_triggered"]) == "Yes",
            "flagged": bool(fired),
            "types": fired,
            "score": round(_score(feat), 2),
            "evidence": {
                "idle_min": float(r["idling_time_min"]),
                "load_cycles": int(r["load_cycles"]),
                "seatbelt": str(r["seatbelt_status"]),
            },
        })
    return out
