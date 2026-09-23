"""Train every model.

    uv run python -m intelligence.train

Must finish in under five minutes.  The numbers it prints are the ones that go
on the pitch slide, so they are computed on a held-out split, never on training
data.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .anomaly import FEATURES as ANOMALY_FEATURES
from .anomaly import WINDOW_MIN, window_features
from .features import CATEGORICAL, FEATURES, TARGET, to_frame

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MODEL_DIR = Path(__file__).resolve().parent / "models"

QUANTILES = {"p10": 0.1, "p50": 0.5, "p90": 0.9}

# Swept, not guessed.  Two things had to hold at once:
#
#   * P10-P90 coverage near the 80% it should be by construction.  A bigger
#     model fits the training quantiles so tightly that test coverage collapses
#     - 3,000 rounds gives 62%, 120 rounds gives ~80%.
#   * A sensibly *shaped* interval.  Giving P50 a bigger model than the tails
#     buys a lower MAPE but pushes P50 up against P90, so the UI shows a
#     "130-132 min" interval that is really 110-160.  All three quantiles are
#     therefore fitted at identical capacity, and the slightly higher MAPE is
#     the price of an honest interval.
_PARAMS = {"learning_rate": 0.05, "num_leaves": 7, "min_data_in_leaf": 200,
           "feature_fraction": 0.7, "bagging_fraction": 0.8, "bagging_freq": 1,
           "lambda_l2": 1.0}
PARAMS = {name: _PARAMS for name in QUANTILES}
ROUNDS = {name: 120 for name in QUANTILES}
TEST_FRACTION = 0.2
SEED = 42


def _split(df: pd.DataFrame, seed: int = SEED):
    rng = np.random.default_rng(seed)
    mask = rng.random(len(df)) < TEST_FRACTION
    return df[~mask].copy(), df[mask].copy()


# --------------------------------------------------------------------------
# task time
# --------------------------------------------------------------------------

def train_task_time() -> dict:
    import lightgbm as lgb

    path = DATA / "tasks.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path} missing - run data-gen/generate.py first")
    df = pd.read_csv(path)
    train_df, test_df = _split(df)

    x_train = to_frame(train_df.to_dict("records"))
    y_train = train_df[TARGET].to_numpy(dtype=float)
    x_test = to_frame(test_df.to_dict("records"))
    y_test = test_df[TARGET].to_numpy(dtype=float)

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    preds: dict[str, np.ndarray] = {}
    for name, alpha in QUANTILES.items():
        booster = lgb.train(
            {"objective": "quantile", "alpha": alpha,
             "verbosity": -1, "seed": SEED, **PARAMS[name]},
            lgb.Dataset(x_train, label=y_train,
                        categorical_feature=list(CATEGORICAL)),
            num_boost_round=ROUNDS[name],
        )
        booster.save_model(str(MODEL_DIR / f"task_time_{name}.txt"))
        preds[name] = booster.predict(x_test)

    p50 = preds["p50"]
    mape = float(np.mean(np.abs((y_test - p50) / np.clip(y_test, 1e-6, None))) * 100)
    mae = float(np.mean(np.abs(y_test - p50)))
    coverage = float(np.mean((y_test >= preds["p10"]) & (y_test <= preds["p90"])) * 100)

    baseline = test_df["estimated_time_min"].to_numpy(dtype=float)
    baseline_mape = float(
        np.mean(np.abs((y_test - baseline) / np.clip(y_test, 1e-6, None))) * 100
    )

    metrics = {
        "rows_train": int(len(train_df)),
        "rows_test": int(len(test_df)),
        "p50_mape_pct": round(mape, 2),
        "p50_mae_min": round(mae, 2),
        "p10_p90_coverage_pct": round(coverage, 1),
        "planner_baseline_mape_pct": round(baseline_mape, 2),
        "improvement_vs_planner_pct": round(baseline_mape - mape, 2),
        "features": FEATURES,
    }
    (MODEL_DIR / "task_time_meta.json").write_text(json.dumps(metrics, indent=2))
    return metrics


# --------------------------------------------------------------------------
# anomalies
# --------------------------------------------------------------------------

def _windowed(telemetry: pd.DataFrame) -> pd.DataFrame:
    telemetry = telemetry.copy()
    telemetry["timestamp"] = pd.to_datetime(telemetry["timestamp"])
    telemetry["_window"] = telemetry["timestamp"].dt.floor(f"{WINDOW_MIN}min")
    rows = []
    for (machine_id, window), group in telemetry.groupby(["machine_id", "_window"]):
        if len(group) < WINDOW_MIN // 2:
            continue
        feat = window_features(group)
        feat["machine_id"] = machine_id
        feat["window"] = window
        feat["date"] = window.strftime("%Y-%m-%d")
        rows.append(feat)
    return pd.DataFrame(rows)


def train_anomaly() -> dict:
    import joblib
    from sklearn.ensemble import IsolationForest

    path = DATA / "telemetry.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path} missing - run data-gen/generate.py first")
    telemetry = pd.read_csv(path, parse_dates=["timestamp"])
    windows = _windowed(telemetry)

    x = windows[ANOMALY_FEATURES].to_numpy(dtype=float)
    forest = IsolationForest(
        contamination=0.05, random_state=SEED, n_estimators=200
    ).fit(x)

    # per-machine baselines, so "unusual" means unusual *for this machine*
    baselines: dict[str, dict] = {}
    for machine_id, group in windows.groupby("machine_id"):
        baselines[machine_id] = {
            f: {"mean": float(group[f].mean()), "std": float(group[f].std() or 1e-6)}
            for f in ANOMALY_FEATURES
        }

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": forest, "baselines": baselines, "features": ANOMALY_FEATURES},
                MODEL_DIR / "anomaly_iforest.joblib")

    metrics = {"windows": int(len(windows)), "machines": int(windows["machine_id"].nunique())}

    # how well do we recover the anomalies we deliberately injected?
    labels_path = DATA / "anomaly_labels.csv"
    if labels_path.exists():
        labels = pd.read_csv(labels_path)
        injected = set(zip(labels["date"], labels["machine_id"]))
        if injected:
            # re-import here so the freshly saved model is the one used
            import intelligence.anomaly as anomaly_module
            anomaly_module._forest = None
            anomaly_module._baselines = None

            found = anomaly_module.analyse_windows(telemetry)
            found_shifts = {(a["window"]["start"][:10], a["machine_id"]) for a in found}
            hits = injected & found_shifts
            metrics.update({
                "injected_shifts": len(injected),
                "injected_shifts_detected": len(hits),
                "injected_recall_pct": round(len(hits) / len(injected) * 100, 1),
                "flagged_windows": len(found),
                "flagged_shifts": len(found_shifts),
            })

    # the headline claim: does it flag the brief's own sample rows?
    import intelligence.anomaly as anomaly_module
    brief = anomaly_module.score_brief_sample()
    if brief:
        expected = [r for r in brief if r["expected_alert"]]
        caught = [r for r in expected if r["flagged"]]
        clean = [r for r in brief if not r["expected_alert"]]
        false_alarms = [r for r in clean if r["flagged"]]
        metrics["brief_sample"] = {
            "rows": len(brief),
            "expected_alerts": len(expected),
            "detected": len(caught),
            "false_alarms": len(false_alarms),
        }

    (MODEL_DIR / "anomaly_meta.json").write_text(json.dumps(metrics, indent=2))
    return metrics


# --------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Train CAT Copilot models")
    ap.add_argument("--skip-anomaly", action="store_true")
    ap.add_argument("--skip-task-time", action="store_true")
    args = ap.parse_args(argv)

    started = time.time()
    print("training models ->", MODEL_DIR)

    if not args.skip_task_time:
        t0 = time.time()
        m = train_task_time()
        print(f"\n  task time  ({time.time() - t0:.1f}s)")
        print(f"    rows                {m['rows_train']:,} train / {m['rows_test']:,} test")
        print(f"    P50 MAPE            {m['p50_mape_pct']}%   (MAE {m['p50_mae_min']} min)")
        print(f"    P10-P90 coverage    {m['p10_p90_coverage_pct']}%   (target ~80%)")
        print(f"    planner baseline    {m['planner_baseline_mape_pct']}% MAPE")
        print(f"    improvement         {m['improvement_vs_planner_pct']} points")

    if not args.skip_anomaly:
        t0 = time.time()
        m = train_anomaly()
        print(f"\n  anomalies  ({time.time() - t0:.1f}s)")
        print(f"    windows scored      {m['windows']:,} across {m['machines']} machines")
        if "injected_recall_pct" in m:
            print(f"    injected anomalies  {m['injected_shifts_detected']}/{m['injected_shifts']}"
                  f" shifts detected ({m['injected_recall_pct']}%)")
            print(f"    windows flagged     {m['flagged_windows']:,}")
        if "brief_sample" in m:
            b = m["brief_sample"]
            print(f"    brief sample rows   {b['detected']}/{b['expected_alerts']} expected alerts"
                  f" detected, {b['false_alarms']} false alarms")

    print(f"\ndone in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
