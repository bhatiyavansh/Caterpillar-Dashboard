"""THE single place where Person A's in-browser twin format is mapped to the contract.

Twin (`src/types/twin.ts`, `src/lib/twin/site.ts`):
  * metres, +X east, **-Z north**, +Y up, site 260 m square centred on (0, 0)
  * heading/pitch/roll/boom/stick/bucket/swing in **radians**; heading 0 = north, clockwise
  * speed m/s, **negative when reversing**; nearestPerson = Infinity (JSON: null) when nobody tracked
  * IDs EXC001, DZR001, LDR001, TRK001; workers WRK001..WRK006
Contract (C's `simulator/schemas.py`): metres in a 400 x 300 site, origin SW corner, y north, degrees.

Everything here is a constant or a pure function so the mapping can be reviewed and tested in one
file. Fields the twin does not produce (seatbelt, operator_id, engine_hours, fuel_used_l,
load_cycles, idle_min, coolant_temp_c, fatigue_score, zone) are left ABSENT, never invented.
"""

from __future__ import annotations

import math
from typing import Any

from simulator.site import to_latlon

# --------------------------------------------------------------------------- IDs  [TEAM TO CONFIRM: A]
MACHINE_IDS: dict[str, str] = {"EXC001": "EXC001", "DZR001": "DOZ001", "LDR001": "WHL001", "TRK001": "TRK001"}
#: model / machine_type as the twin itself describes them (LDR001 is a 966M in the twin, not C's 950).
MACHINE_INFO: dict[str, tuple[str, str]] = {
    "EXC001": ("320", "excavator"),
    "DOZ001": ("D6", "dozer"),
    "WHL001": ("966M", "wheel_loader"),
    "TRK001": ("745", "truck"),
}


def worker_id(twin_id: str) -> str:
    """WRK003 -> W03 (C's worker IDs are W01..W06)."""
    digits = "".join(ch for ch in twin_id if ch.isdigit())
    return f"W{int(digits):02d}" if digits else twin_id


# --------------------------------------------------------------------------- geometry  [TEAM TO CONFIRM: A]
#: site_x = twin_x * SCALE + OFFSET_X ; site_y = -twin_z * SCALE + OFFSET_Y
SCALE = 1.0
OFFSET_X = 200.0
OFFSET_Y = 150.0


def twin_to_site(x: float, z: float) -> tuple[float, float]:
    return round(x * SCALE + OFFSET_X, 2), round(-z * SCALE + OFFSET_Y, 2)


def site_to_twin(x: float, y: float) -> tuple[float, float]:
    return (x - OFFSET_X) / SCALE, -(y - OFFSET_Y) / SCALE


def rad_to_deg(v: float | None) -> float | None:
    return None if v is None else round(math.degrees(v), 2)


def heading_deg(rad: float) -> float:
    return round(math.degrees(rad) % 360.0, 1)


# --------------------------------------------------------------------------- proximity (twin constants)
#: src/lib/twin/proximity.ts PROXIMITY.warning / critical, metres
PROX_WARNING_M = 10.0
PROX_CRITICAL_M = 6.0
NEAREST_CAP_M = 99.0  # C caps nearest_person_m at 99


def bubble(nearest: float | None) -> str:
    if nearest is None:
        return "green"
    if nearest <= PROX_CRITICAL_M:
        return "red"
    if nearest <= PROX_WARNING_M:
        return "amber"
    return "green"


# --------------------------------------------------------------------------- activity -> intent/status
def intent(activity: str, speed: float, swing_delta: float | None) -> str:
    if activity == "traveling":
        return "reverse" if speed < 0 else "travel_forward"
    if activity == "digging":
        return "dig"
    if activity == "loading":  # twin "loading" = opening a full bucket = dumping
        return "dump"
    if activity == "swinging":
        # ASSUMPTION [A to confirm]: positive swingAngle rate = clockwise = swing_right.
        return "swing_right" if (swing_delta or 0.0) > 0 else "swing_left"
    return "idle"


def status(activity: str, speed: float) -> str:
    if activity in ("idle", "emergency_stop"):
        return "idle"
    return "travelling" if abs(speed) > 0.3 else "working"


# --------------------------------------------------------------------------- alerts -> events
#: twin AlertKind -> (event name, severity by twin severity)
ALERT_EVENTS: dict[str, tuple[str, dict[str, str]]] = {
    "proximity": ("proximity_alert", {"critical": "critical", "warning": "high", "info": "medium"}),
    "collision": ("v2v_collision_risk", {"critical": "high", "warning": "high", "info": "medium"}),
    "tip_over": ("tip_over_warning", {"critical": "critical", "warning": "medium", "info": "medium"}),
    "hydraulic": ("maintenance_due", {"critical": "medium", "warning": "medium", "info": "info"}),
    "fuel": ("low_fuel", {"critical": "high", "warning": "medium", "info": "info"}),
    "engine": ("engine_fault", {"critical": "high", "warning": "medium", "info": "info"}),
    "emergency_stop": ("emergency_stop", {"critical": "critical", "warning": "high", "info": "high"}),
}
#: weather comes from the snapshot.weather diff in TwinAdapter, not from the twin's weather alert
ALERT_SOURCE: dict[str, str] = {"collision": "v2v"}


def machine_payload(t: dict[str, Any], ts: str, swing_delta: float | None) -> dict[str, Any] | None:
    mid = MACHINE_IDS.get(t.get("machineId", ""))
    if mid is None:
        return None
    model, mtype = MACHINE_INFO[mid]
    x, y = twin_to_site(float(t["x"]), float(t["z"]))
    lat, lon = to_latlon(x, y)
    speed = float(t.get("speed", 0.0))
    nearest = t.get("nearestPerson")
    nearest = None if nearest is None or (isinstance(nearest, float) and math.isinf(nearest)) else float(nearest)
    activity = t.get("activity", "idle")
    return {
        "type": "machine_state",
        "ts": ts,
        "machine_id": mid,
        "model": model,
        "machine_type": mtype,
        "status": status(activity, speed),
        "pos": {"x": x, "y": y, "lat": lat, "lon": lon},
        "heading_deg": heading_deg(float(t.get("heading", 0.0))),
        "speed_mps": round(abs(speed), 2),
        "intent": intent(activity, speed, swing_delta),
        "engine_on": float(t.get("engineRpm", 0)) > 0,
        "fuel_level_pct": round(float(t.get("fuel", 0.0)), 1),
        "boom_angle_deg": rad_to_deg(t.get("boomAngle")),
        "stick_angle_deg": rad_to_deg(t.get("stickAngle")),
        "swing_angle_deg": rad_to_deg(t.get("swingAngle")),
        "payload_kg": round(float(t.get("payload", 0.0))),
        "hydraulic_temp_c": round(float(t.get("hydraulicTemperature", 0.0)), 1),
        "pitch_deg": rad_to_deg(t.get("pitch")),
        "roll_deg": rad_to_deg(t.get("roll")),
        "tip_over_margin": round(float(t.get("tipOverMargin", 0.0)), 2),
        "bubble": bubble(nearest),
        "nearest_person_m": NEAREST_CAP_M if nearest is None else round(min(nearest, NEAREST_CAP_M), 1),
        "fault_codes": [],
    }


def worker_payload(w: dict[str, Any], ts: str) -> dict[str, Any]:
    x, y = twin_to_site(float(w["x"]), float(w["z"]))
    lat, lon = to_latlon(x, y)
    return {"type": "worker_state", "ts": ts, "worker_id": worker_id(w["id"]), "pos": {"x": x, "y": y, "lat": lat, "lon": lon}}


def alert_event(alert: dict[str, Any], ts: str, event_id: str) -> dict[str, Any] | None:
    mapping = ALERT_EVENTS.get(alert.get("kind", ""))
    if mapping is None:
        return None
    name, sev = mapping
    data: dict[str, Any] = {"twin_alert_id": alert.get("id"), "detail": alert.get("detail", {})}
    return {
        "type": "event",
        "id": event_id,
        "ts": ts,
        "event": name,
        "severity": sev.get(alert.get("severity", "warning"), "medium"),
        "machine_id": MACHINE_IDS.get(alert.get("machineId", ""), alert.get("machineId")),
        "source": ALERT_SOURCE.get(alert.get("kind", ""), "simulator"),
        "message": f"{alert.get('title', name)}: {alert.get('message', '')}".strip(": "),
        "data": data,
    }
