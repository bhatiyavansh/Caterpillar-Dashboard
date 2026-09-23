"""Tip-over stability and proximity bubble geometry."""

from __future__ import annotations

import math

from .config import (
    BUBBLE_AMBER_BASE_M,
    BUBBLE_RED_BASE_M,
    MachineSpec,
)

MARGIN_MIN = 0.30
MARGIN_MAX = 5.00


def excavator_reach(boom_deg: float, stick_deg: float, spec: MachineSpec) -> float:
    """Horizontal reach of the payload from the slew centre, metres."""
    return (
        spec.boom_len * math.cos(math.radians(boom_deg))
        + spec.stick_len * math.cos(math.radians(boom_deg + stick_deg))
    )


def tip_over_margin(
    boom_deg: float,
    stick_deg: float,
    swing_deg: float,
    payload_kg: float,
    pitch_deg: float,
    roll_deg: float,
    spec: MachineSpec,
) -> float:
    """Simplified 2D stability ratio about the active tipping edge.

    >1.5 green, 1.2-1.5 amber, <1.2 red.  Normal trenching lands around 1.6-3.0;
    the heavy_lift scenario is tuned to drop below 1.2.
    """
    reach = excavator_reach(boom_deg, stick_deg, spec)

    # over the tracks (front/rear) the machine is far more stable than over the side
    over_ends = abs(math.cos(math.radians(swing_deg))) > 0.7
    edge = spec.track_half_length if over_ends else spec.track_half_width

    slope = max(abs(pitch_deg), abs(roll_deg))
    base_arm = max(edge - spec.cog_height * math.tan(math.radians(slope)), 0.05)

    m_restoring = (
        spec.mass_kg * 9.81 * base_arm
        + spec.counterweight_mass * 9.81 * (spec.counterweight_arm + edge)
    )
    m_overturning = (
        (payload_kg + spec.bucket_mass) * 9.81 * max(reach - edge, 0.01)
        + spec.arm_mass * 9.81 * max(reach / 2 - edge, 0.01)
    )
    if m_overturning <= 0:
        return MARGIN_MAX
    return round(min(max(m_restoring / m_overturning, MARGIN_MIN), MARGIN_MAX), 2)


def simple_margin(pitch_deg: float, roll_deg: float) -> float:
    """Slope-only margin for non-excavator machines."""
    slope = max(abs(pitch_deg), abs(roll_deg))
    return round(max(3.0 - slope * 0.08, 0.8), 2)


def bubble_radii(
    speed_mps: float,
    swing_radius_m: float = 0.0,
) -> tuple[float, float]:
    """(red_radius, amber_radius) in metres, scaled by speed and swing envelope."""
    r_red = BUBBLE_RED_BASE_M + 1.5 * speed_mps + swing_radius_m
    r_amber = BUBBLE_AMBER_BASE_M + 2.0 * speed_mps + swing_radius_m
    return round(r_red, 2), round(r_amber, 2)


def bubble_colour(
    nearest_person_m: float,
    nearest_machine_m: float,
    speed_mps: float,
    swing_radius_m: float = 0.0,
) -> str:
    """Worst of (nearest worker, nearest machine weighted 0.5)."""
    r_red, r_amber = bubble_radii(speed_mps, swing_radius_m)
    effective = min(nearest_person_m, nearest_machine_m * 0.5)
    if effective < r_red:
        return "red"
    if effective < r_amber:
        return "amber"
    return "green"


def proximity_zone(
    machine_x: float, machine_y: float, heading_deg: float,
    px: float, py: float,
) -> str:
    """Which quadrant of the machine a point sits in: front|rear|left|right."""
    dx, dy = px - machine_x, py - machine_y
    # heading 0 = north (+y), clockwise
    bearing = (math.degrees(math.atan2(dx, dy)) - heading_deg) % 360.0
    if bearing < 45 or bearing >= 315:
        return "front"
    if bearing < 135:
        return "right"
    if bearing < 225:
        return "rear"
    return "left"
