"""Person C's intelligence package - imported directly by Person B's backend.

Every function returns plain, JSON-safe Python (no numpy types, no NaN, no
datetime objects) and loads its models lazily, so importing this package is
cheap even before `intelligence.train` has ever been run.
"""

from .anomaly import get_anomalies, score_brief_sample, score_live_window
from .live import (
    get_fleet_overview,
    get_machine_status,
    get_recent_events,
    get_shift_tasks,
    reorder_tasks,
    simulator_online,
    trigger_scenario,
)
from .maintenance import get_maintenance_forecast
from .risk import get_working_risk
from .summaries import (
    fleet_kpis,
    heatmap_points,
    incident_index,
    leaderboard,
    owner_summary,
    training_profiles,
    utilization_series,
)
from .task_time import model_metrics, predict_remaining, predict_task_time
from .whatif import run_what_if

__all__ = [
    "predict_task_time", "predict_remaining", "model_metrics",
    "get_anomalies", "score_live_window", "score_brief_sample",
    "get_working_risk", "get_maintenance_forecast", "run_what_if",
    "fleet_kpis", "owner_summary", "utilization_series", "leaderboard",
    "training_profiles", "incident_index", "heatmap_points",
    "get_machine_status", "get_fleet_overview", "get_shift_tasks",
    "reorder_tasks", "get_recent_events", "simulator_online", "trigger_scenario",
]
