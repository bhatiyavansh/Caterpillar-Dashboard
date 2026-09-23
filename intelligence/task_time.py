"""Task-time prediction: three LightGBM quantile models plus SHAP reasons.

C predicts and explains *numerically*.  B's LLM turns `reasons` into a
sentence - nothing here writes prose.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .features import FEATURES, describe, to_frame

MODEL_DIR = Path(__file__).resolve().parent / "models"
QUANTILES = {"p10": 0.1, "p50": 0.5, "p90": 0.9}
MAX_REASONS = 4
MIN_IMPACT_MIN = 1.0

_models: dict[str, object] | None = None
_explainer = None
_meta: dict | None = None


def model_path(name: str) -> Path:
    return MODEL_DIR / f"task_time_{name}.txt"


def models_available() -> bool:
    return all(model_path(name).exists() for name in QUANTILES)


def _load() -> dict[str, object]:
    """Lazy-load the boosters; B's backend imports this at startup."""
    global _models, _meta
    if _models is not None:
        return _models
    import lightgbm as lgb

    if not models_available():
        raise FileNotFoundError(
            "task-time models are missing - run `uv run python -m intelligence.train`"
        )
    _models = {name: lgb.Booster(model_file=str(model_path(name))) for name in QUANTILES}
    meta_file = MODEL_DIR / "task_time_meta.json"
    _meta = json.loads(meta_file.read_text()) if meta_file.exists() else {}
    return _models


def _shap_reasons(frame) -> list[dict]:
    """Attribute the P50 prediction to features, in minutes."""
    global _explainer
    import shap

    models = _load()
    if _explainer is None:
        _explainer = shap.TreeExplainer(models["p50"])
    values = _explainer.shap_values(frame)
    contributions = np.asarray(values)[0]

    row = frame.iloc[0]
    ranked = sorted(
        zip(FEATURES, contributions),
        key=lambda kv: abs(kv[1]),
        reverse=True,
    )
    reasons = []
    for feature, impact in ranked:
        if abs(impact) < MIN_IMPACT_MIN:
            continue
        reasons.append({
            "feature": feature,
            "label": describe(feature, row[feature]),
            "impact_min": int(round(float(impact))),
        })
        if len(reasons) >= MAX_REASONS:
            break
    return reasons


def _fallback(task: dict) -> dict:
    """Used before the models are trained, so the demo never shows a blank ETA.

    This is the planner's own arithmetic, not a prediction - `model` says so.
    """
    from simulator.config import SOIL_FACTOR, WEATHER_FACTOR, SKILL_FACTOR
    from simulator.tasks import planner_estimate_min

    volume = float(task.get("volume_m3", 120))
    model = str(task.get("machine_model", "320"))
    task_type = str(task.get("task_type", "trenching"))
    p50 = planner_estimate_min(task_type, model, volume)
    p50 *= WEATHER_FACTOR.get(str(task.get("weather", "clear")), 1.0)
    p50 *= SOIL_FACTOR.get(str(task.get("soil", "mixed")), 1.0)
    p50 *= SKILL_FACTOR.get(str(task.get("operator_skill", "intermediate")), 1.0)
    return {
        "p10": round(p50 * 0.85, 1), "p50": round(p50, 1), "p90": round(p50 * 1.25, 1),
        "unit": "min", "model": "planner_fallback", "reasons": [],
    }


def predict_task_time(task: dict) -> dict:
    """Predict how long a task will take.

    `task` uses the tasks.csv feature columns; anything missing gets a default.
    Returns p10/p50/p90 in minutes plus the top few reasons, each in minutes.
    """
    if not models_available():
        return _fallback(task)

    models = _load()
    frame = to_frame(task)
    out = {
        name: float(models[name].predict(frame)[0])
        for name in QUANTILES
    }
    # quantile models are fitted independently and can cross over on odd inputs
    p10, p50, p90 = sorted((out["p10"], out["p50"], out["p90"]))

    try:
        reasons = _shap_reasons(frame)
    except Exception:
        reasons = []

    return {
        "p10": round(p10, 1),
        "p50": round(p50, 1),
        "p90": round(p90, 1),
        "unit": "min",
        "model": "lightgbm_quantile",
        "reasons": reasons,
    }


def predict_remaining(task: dict, progress: float) -> dict:
    """Scale a full-task prediction by the fraction still to do.

    Used for `task_eta_min` in the live stream.
    """
    full = predict_task_time(task)
    left = max(0.0, min(1.0, 1.0 - float(progress)))
    return {
        "p10": round(full["p10"] * left, 1),
        "p50": round(full["p50"] * left, 1),
        "p90": round(full["p90"] * left, 1),
        "unit": "min",
        "model": full["model"],
        "reasons": full["reasons"],
    }


def model_metrics() -> dict:
    """Training metrics for the pitch slide, if the models have been trained."""
    _load() if models_available() else None
    return dict(_meta or {})
