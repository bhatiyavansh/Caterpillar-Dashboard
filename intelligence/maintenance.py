"""Component health forecasting.

Fit the last 14 days of each component's health, extrapolate to the service
threshold, and convert days into operating hours.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parent.parent / "data"

SERVICE_THRESHOLD_PCT = 30.0
FIT_DAYS = 14
HOURS_PER_DAY = 10.0
MAX_HORIZON_HOURS = 2_000

COMPONENTS = {
    "hydraulic_health": ("hydraulic_pump", ["Hydraulic oil filter", "Pump seal kit"]),
    "engine_health": ("engine", ["Engine oil filter", "Air filter", "Fuel filter"]),
    "undercarriage_health": ("undercarriage", ["Track chain", "Idler seal", "Sprocket"]),
}


def _confidence(r2: float, points: int) -> str:
    if points < 7 or r2 < 0.3:
        return "low"
    if r2 < 0.7:
        return "medium"
    return "high"


def get_maintenance_forecast(machine_id: str | None = None) -> list[dict]:
    """When each component reaches the service threshold, and what to order."""
    path = DATA / "maintenance.csv"
    if not path.exists():
        return []
    df = pd.read_csv(path, parse_dates=["date"])
    if machine_id:
        df = df[df["machine_id"] == machine_id]
    if df.empty:
        return []

    latest = df["date"].max()
    window = df[df["date"] > latest - timedelta(days=FIT_DAYS)]

    out: list[dict] = []
    for mid, rows in window.groupby("machine_id"):
        rows = rows.sort_values("date")
        x = (rows["date"] - rows["date"].min()).dt.days.to_numpy(dtype=float)
        if len(x) < 3:
            continue
        for column, (component, parts) in COMPONENTS.items():
            y = rows[column].to_numpy(dtype=float)
            slope, intercept = np.polyfit(x, y, 1)
            fitted = slope * x + intercept
            ss_res = float(((y - fitted) ** 2).sum())
            ss_tot = float(((y - y.mean()) ** 2).sum()) or 1e-9
            r2 = max(0.0, 1 - ss_res / ss_tot)

            current = float(y[-1])
            if slope >= -1e-6:
                # not declining: nothing to forecast
                days_left = float("inf")
            else:
                days_left = (current - SERVICE_THRESHOLD_PCT) / (-slope)

            if not np.isfinite(days_left) or days_left < 0:
                hours = MAX_HORIZON_HOURS if current > SERVICE_THRESHOLD_PCT else 0
                due = None
            else:
                hours = int(min(days_left * HOURS_PER_DAY, MAX_HORIZON_HOURS))
                due = (latest + timedelta(days=float(days_left))).strftime("%Y-%m-%d")

            out.append({
                "machine_id": mid,
                "component": component,
                "health_pct": round(current, 1),
                "decline_pct_per_day": round(float(-slope), 3),
                "hours_to_service": hours,
                "due_date": due,
                "confidence": _confidence(r2, len(x)),
                "recommended_parts": parts,
            })

    out.sort(key=lambda r: r["hours_to_service"])
    return out
