"""Export the intelligence layer in a form the browser can run.

The frontend cannot load a LightGBM booster or an Isolation Forest, but it can
evaluate a linear model and a z-score.  So this script fits, on exactly the rows
LightGBM trains on, a multiplicative correction to the planner's own estimate:

    actual = planner_estimate * exp(b0 + sum(coefficients . features))

That is a real model fitted to the 30-day history, not a guess, and it is
honest about being the simpler of the two - `metrics` carries its held-out MAPE
next to LightGBM's so the gap is visible rather than hidden.

The anomaly layer needs no refit: the per-machine baselines the Isolation Forest
was fitted alongside are already means and standard deviations, so they are
exported as-is and the browser scores z-distance against them.

    uv run python scripts/export_intel.py
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MODELS = ROOT / "intelligence" / "models"
OUT = ROOT / "src" / "data" / "generated" / "intel.json"

SEED = 42
CATEGORICAL = {
    "task_type": ["trenching", "loading", "grading", "dozing", "hauling"],
    "machine_model": ["320", "950", "D6", "745", "140"],
    "operator_skill": ["novice", "intermediate", "expert"],
    "soil": ["sand", "mixed", "clay", "rock"],
    "weather": ["clear", "heat", "wind", "rain", "fog"],
}
# Numerics are centred before fitting so the intercept stays interpretable as
# "the correction for a typical job", which is what the UI shows as the base.
NUMERIC = [
    "volume_m3",
    "operator_years",
    "temperature_c",
    "visibility_m",
    "site_congestion",
    "time_of_day",
    "machine_health",
]


def design(frame: pd.DataFrame, centres: dict[str, float], scales: dict[str, float]):
    """One-hot the categoricals (first level dropped) and standardise numerics."""
    cols: list[np.ndarray] = []
    names: list[str] = []
    for feature, levels in CATEGORICAL.items():
        for level in levels[1:]:
            cols.append((frame[feature].astype(str) == level).to_numpy(dtype=float))
            names.append(f"{feature}={level}")
    for feature in NUMERIC:
        values = pd.to_numeric(frame[feature], errors="coerce").fillna(centres[feature])
        cols.append(((values - centres[feature]) / scales[feature]).to_numpy(dtype=float))
        names.append(feature)
    return np.column_stack(cols), names


def mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    return float(np.mean(np.abs((actual - predicted) / actual)) * 100)


def main() -> None:
    tasks = pd.read_csv(DATA / "tasks.csv")
    tasks = tasks[(tasks["actual_time_min"] > 0) & (tasks["estimated_time_min"] > 0)]

    centres = {f: float(tasks[f].median()) for f in NUMERIC}
    scales = {f: float(tasks[f].std() or 1.0) for f in NUMERIC}

    x, names = design(tasks, centres, scales)
    # The target is the log of how wrong the planner was, so the model only ever
    # has to learn the correction - never the job size itself.
    y = np.log(tasks["actual_time_min"].to_numpy() / tasks["estimated_time_min"].to_numpy())

    x_train, x_test, y_train, y_test, train_rows, test_rows = train_test_split(
        x, y, tasks, test_size=0.2, random_state=SEED
    )

    fit = Ridge(alpha=1.0).fit(x_train, y_train)

    predicted_log = fit.predict(x_test)
    predicted = test_rows["estimated_time_min"].to_numpy() * np.exp(predicted_log)
    actual = test_rows["actual_time_min"].to_numpy()

    # The band comes from the spread of what the model still gets wrong on rows
    # it never saw, which is the only honest source for it.
    residual = np.log(actual / predicted)
    q10, q90 = float(np.quantile(residual, 0.10)), float(np.quantile(residual, 0.90))
    covered = float(
        np.mean(
            (actual >= predicted * np.exp(q10)) & (actual <= predicted * np.exp(q90))
        )
        * 100
    )

    lgbm_meta = json.loads((MODELS / "task_time_meta.json").read_text())
    anomaly_meta = json.loads((MODELS / "anomaly_meta.json").read_text())

    import joblib

    bundle = joblib.load(MODELS / "anomaly_iforest.joblib")
    baselines = bundle.get("baselines", {})

    from simulator.config import (
        BASE_RATE,
        DEFAULT_BASE_RATE,
        DIESEL_PRICE_INR,
        SKILL_FACTOR,
        SOIL_FACTOR,
        SPECS,
        WEATHER_FACTOR,
    )

    payload = {
        "meta": {
            "generatedAt": pd.Timestamp.now("UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
            "seed": SEED,
            "rowsTrain": int(len(x_train)),
            "rowsTest": int(len(x_test)),
        },
        "taskTime": {
            "intercept": float(fit.intercept_),
            "coefficients": {name: float(c) for name, c in zip(names, fit.coef_)},
            "centres": centres,
            "scales": scales,
            "categorical": CATEGORICAL,
            "numeric": NUMERIC,
            "residualQuantiles": {"p10": q10, "p90": q90},
            "baseRate": {f"{t}|{m}": r for (t, m), r in BASE_RATE.items()},
            "defaultBaseRate": DEFAULT_BASE_RATE,
            "plannerFactors": {
                "weather": WEATHER_FACTOR,
                "soil": SOIL_FACTOR,
                "skill": SKILL_FACTOR,
            },
            "metrics": {
                "ridgeMapePct": round(mape(actual, predicted), 2),
                "plannerMapePct": round(
                    mape(actual, test_rows["estimated_time_min"].to_numpy()), 2
                ),
                "coveragePct": round(covered, 1),
                "lightgbmMapePct": lgbm_meta.get("p50_mape_pct"),
                "lightgbmCoveragePct": lgbm_meta.get("p10_p90_coverage_pct"),
            },
        },
        "anomaly": {
            "windowMin": 120,
            "thresholds": {
                "idleRatioHigh": 0.45,
                "productivityLowRatio": 0.5,
                "cyclesPerHourFallback": 30.0,
                "overloadRatio": 1.10,
                "harshMultiplier": 3.0,
                "tempHighC": 95.0,
                "seatbeltOffRatio": 0.30,
            },
            "baselines": baselines,
            "metrics": anomaly_meta,
        },
        "specs": {
            model: {
                "machineType": spec.machine_type,
                "maxPayloadKg": spec.max_payload_kg,
                "workingFuelLph": spec.working_fuel_lph,
                "idleFuelLph": spec.idle_fuel_lph,
                "tankL": spec.tank_l,
                "bucketM3": spec.bucket_m3,
                "cycleS": spec.cycle_s,
            }
            for model, spec in SPECS.items()
        },
        "dieselPriceInr": DIESEL_PRICE_INR,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    m = payload["taskTime"]["metrics"]
    print(f"wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"  ridge MAPE {m['ridgeMapePct']}%  planner {m['plannerMapePct']}%  "
          f"lightgbm {m['lightgbmMapePct']}%  coverage {m['coveragePct']}%")


if __name__ == "__main__":
    main()
