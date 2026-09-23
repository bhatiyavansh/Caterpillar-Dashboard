"""Safety rules and the event bus.

Rules turn world state into `event` messages.  Every emission goes through
EventBus so debouncing and id allocation happen in exactly one place.
"""

from __future__ import annotations

from datetime import datetime, timezone

from .config import (
    EVENT_DEBOUNCE_S,
    SEATBELT_ESCALATE_S,
    TIP_OVER_AMBER,
    TIP_OVER_RED,
)
from .physics import bubble_radii, proximity_zone

FATIGUE_ALERT_THRESHOLD = 0.75
HYDRAULIC_ALERT_C = 95.0


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class EventBus:
    """Collects events for the current tick, with per-(event, machine) debounce."""

    def __init__(self, debounce_s: float = EVENT_DEBOUNCE_S) -> None:
        self._counter = 0
        self._last_sent: dict[tuple[str, str | None], float] = {}
        self._debounce_s = debounce_s
        self.pending: list[dict] = []
        self.history: list[dict] = []

    def emit(
        self,
        event: str,
        severity: str,
        message: str,
        machine_id: str | None = None,
        source: str = "rules",
        data: dict | None = None,
        sim_time_s: float = 0.0,
        force: bool = False,
        debounce_s: float | None = None,
    ) -> dict | None:
        """Queue an event.  Returns the event dict, or None if debounced.

        `debounce_s` overrides the default window - advisories that describe a
        sustained condition (low fuel, a deep queue) use a much longer one than
        safety alerts, so they do not flood the stream while the condition holds.
        """
        key = (event, machine_id)
        if not force:
            window = self._debounce_s if debounce_s is None else debounce_s
            last = self._last_sent.get(key)
            if last is not None and sim_time_s - last < window:
                return None
        self._last_sent[key] = sim_time_s

        self._counter += 1
        evt = {
            "type": "event",
            "id": f"evt_{self._counter:06d}",
            "ts": utc_now_iso(),
            "event": event,
            "severity": severity,
            "machine_id": machine_id,
            "source": source,
            "message": message,
            "data": data or {},
        }
        self.pending.append(evt)
        self.history.append(evt)
        if len(self.history) > 500:
            del self.history[:-500]
        return evt

    def drain(self) -> list[dict]:
        out = self.pending
        self.pending = []
        return out

    def reset_debounce(self) -> None:
        self._last_sent.clear()


# --- individual rules -----------------------------------------------------

def check_seatbelt(machine, bus: EventBus, sim_time_s: float, state: dict) -> None:
    """Three-level escalation: 1 chime -> 2 voice -> 3 travel locked."""
    if not machine.engine_on:
        return
    unfastened = machine.seatbelt == "unfastened"
    since = state.get("unfastened_since")

    if not unfastened:
        if since is not None:
            state["unfastened_since"] = None
            state["level"] = 0
            bus.emit(
                "seatbelt_fastened", "info",
                f"Seatbelt refastened on {machine.machine_id}",
                machine.machine_id, "rules", {}, sim_time_s, force=True,
            )
        return

    if since is None:
        state["unfastened_since"] = sim_time_s
        state["level"] = 0
        since = sim_time_s

    elapsed = sim_time_s - since
    level = min(3, int(elapsed // SEATBELT_ESCALATE_S) + 1)
    if level > state.get("level", 0):
        state["level"] = level
        wording = {
            1: "Seatbelt unfastened - warning chime",
            2: "Seatbelt still unfastened - voice warning",
            3: "Seatbelt unfastened - travel locked",
        }[level]
        bus.emit(
            "seatbelt_unfastened", "high",
            f"{wording} ({machine.machine_id})",
            machine.machine_id, "rules", {"escalation_level": level},
            sim_time_s, force=True,
        )


def check_proximity(machine, workers, bus: EventBus, sim_time_s: float) -> None:
    """Fire when a worker is inside the machine's red bubble."""
    if not machine.engine_on or not workers:
        return
    r_red, _ = bubble_radii(machine.speed_mps, machine.swing_radius_m)
    nearest = None
    nearest_d = 1e9
    for w in workers:
        d = ((w.x - machine.x) ** 2 + (w.y - machine.y) ** 2) ** 0.5
        if d < nearest_d:
            nearest_d, nearest = d, w
    if nearest is None or nearest_d >= r_red:
        return

    zone = proximity_zone(machine.x, machine.y, machine.heading_deg, nearest.x, nearest.y)
    severity = "critical" if nearest_d < 3.0 else "high"
    bus.emit(
        "proximity_alert", severity,
        f"Person detected {nearest_d:.1f} m {zone} of {machine.machine_id}",
        machine.machine_id, "simulator",
        {"distance_m": round(nearest_d, 1), "zone": zone, "worker_id": nearest.worker_id},
        sim_time_s,
    )


def check_tip_over(machine, bus: EventBus, sim_time_s: float) -> None:
    m = machine.tip_over_margin
    if m >= TIP_OVER_AMBER:
        return
    severity = "critical" if m < TIP_OVER_RED else "medium"
    slope = max(abs(machine.pitch_deg), abs(machine.roll_deg))
    verb = "Tip-over risk" if severity == "critical" else "Stability margin low"
    bus.emit(
        "tip_over_warning", severity,
        f"{verb} on {machine.machine_id} - margin {m:.2f}",
        machine.machine_id, "rules",
        {
            "margin": round(m, 2),
            "payload_kg": round(machine.payload_kg, 0),
            "slope_deg": round(slope, 1),
        },
        sim_time_s,
    )


def check_fatigue(machine, bus: EventBus, sim_time_s: float) -> None:
    if machine.fatigue_score < FATIGUE_ALERT_THRESHOLD:
        return
    eyes_closed_s = round(machine.fatigue_score * 4.0, 1)
    bus.emit(
        "fatigue_alert", "high",
        f"Operator fatigue detected on {machine.machine_id} - take a break",
        machine.machine_id, "simulator",
        {"eyes_closed_s": eyes_closed_s, "fatigue_score": round(machine.fatigue_score, 2)},
        sim_time_s,
    )


def check_overheat(machine, bus: EventBus, sim_time_s: float) -> None:
    if machine.hydraulic_temp_c < HYDRAULIC_ALERT_C:
        return
    health = max(10.0, 100.0 - (machine.hydraulic_temp_c - 70.0) * 2.0)
    bus.emit(
        "maintenance_due", "medium",
        f"Hydraulic temperature {machine.hydraulic_temp_c:.0f} C on {machine.machine_id}"
        " - service hydraulic pump",
        machine.machine_id, "rules",
        {
            "component": "hydraulic_pump",
            "health_pct": round(health, 0),
            "hours_to_service": 40,
        },
        sim_time_s,
    )


def run_all(machine, workers, bus: EventBus, sim_time_s: float, belt_state: dict) -> None:
    check_seatbelt(machine, bus, sim_time_s, belt_state)
    check_proximity(machine, workers, bus, sim_time_s)
    check_tip_over(machine, bus, sim_time_s)
    check_fatigue(machine, bus, sim_time_s)
    check_overheat(machine, bus, sim_time_s)
