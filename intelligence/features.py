"""Shared feature definitions for the task-time model.

Training and inference must agree exactly on column order and on the category
levels, or LightGBM silently scores nonsense.  Both import from here.
"""

from __future__ import annotations

import pandas as pd

CATEGORICAL: dict[str, list[str]] = {
    "task_type": ["trenching", "loading", "grading", "dozing", "hauling"],
    "machine_model": ["320", "950", "D6", "745", "140"],
    "operator_skill": ["novice", "intermediate", "expert"],
    "soil": ["sand", "mixed", "clay", "rock"],
    "weather": ["clear", "heat", "wind", "rain", "fog"],
}

NUMERIC: list[str] = [
    "volume_m3",
    "operator_years",
    "temperature_c",
    "visibility_m",
    "site_congestion",
    "time_of_day",
    "machine_health",
    "estimated_time_min",
]

FEATURES: list[str] = list(CATEGORICAL) + NUMERIC
TARGET = "actual_time_min"

DEFAULTS: dict[str, object] = {
    "task_type": "trenching",
    "machine_model": "320",
    "operator_skill": "intermediate",
    "soil": "mixed",
    "weather": "clear",
    "volume_m3": 120.0,
    "operator_years": 5.0,
    "temperature_c": 33.0,
    "visibility_m": 10_000.0,
    "site_congestion": 0.3,
    "time_of_day": 10,
    "machine_health": 0.8,
    "estimated_time_min": 130.0,
}

# how a feature is described back to the operator
LABELS: dict[str, str] = {
    "task_type": "Task type",
    "machine_model": "Machine",
    "operator_skill": "Operator skill",
    "soil": "Ground",
    "weather": "Weather",
    "volume_m3": "Job size",
    "operator_years": "Operator experience",
    "temperature_c": "Temperature",
    "visibility_m": "Visibility",
    "site_congestion": "Site congestion",
    "time_of_day": "Time of day",
    "machine_health": "Machine condition",
    "estimated_time_min": "Planner estimate",
}

VALUE_LABELS: dict[str, dict[str, str]] = {
    "weather": {"clear": "Clear weather", "rain": "Rain", "fog": "Fog",
                "heat": "Extreme heat", "wind": "High wind"},
    "soil": {"sand": "Sandy ground", "mixed": "Mixed ground",
             "clay": "Clay", "rock": "Rock"},
    "operator_skill": {"novice": "Novice operator",
                       "intermediate": "Intermediate operator",
                       "expert": "Expert operator"},
    "task_type": {"trenching": "Trenching", "loading": "Loading",
                  "grading": "Grading", "dozing": "Dozing", "hauling": "Hauling"},
}


def describe(feature: str, value) -> str:
    """A short, human-readable label for one feature value."""
    mapping = VALUE_LABELS.get(feature)
    if mapping is not None:
        return mapping.get(str(value), str(value))
    if feature == "site_congestion":
        v = float(value)
        return "Busy site" if v > 0.5 else ("Quiet site" if v < 0.2 else "Normal site traffic")
    if feature == "machine_health":
        v = float(value)
        return "Machine needs service" if v < 0.6 else "Machine in good condition"
    if feature == "volume_m3":
        return f"Job size {float(value):,.0f}"
    if feature == "visibility_m":
        return f"Visibility {float(value):,.0f} m"
    if feature == "temperature_c":
        return f"{float(value):.0f} C"
    if feature == "operator_years":
        return f"{float(value):.0f} years experience"
    if feature == "time_of_day":
        return f"{int(value):02d}:00 start"
    return f"{LABELS.get(feature, feature)} {value}"


def to_frame(rows: list[dict] | dict) -> pd.DataFrame:
    """Build a model-ready frame, filling anything missing with a default."""
    if isinstance(rows, dict):
        rows = [rows]
    filled = []
    for row in rows:
        item = {k: row.get(k, DEFAULTS[k]) for k in FEATURES}
        # callers pass volume under the task contract's name
        if "volume_m3" not in row and "volume" in row:
            item["volume_m3"] = row["volume"]
        filled.append(item)
    df = pd.DataFrame(filled, columns=FEATURES)
    for col, levels in CATEGORICAL.items():
        df[col] = pd.Categorical(df[col].astype(str), categories=levels)
    for col in NUMERIC:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(DEFAULTS[col])
    return df
