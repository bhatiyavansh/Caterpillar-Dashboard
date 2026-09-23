"""Working-condition risk - transparent rules, no model.

Person C produces the score and the reason list; Person B's LLM turns them into
a sentence.  Nothing here writes prose.
"""

from __future__ import annotations

LOW_MAX = 35
MEDIUM_MAX = 65

# Chennai: heat is a first-class hazard, not a footnote
HEAT_WARN_C = 35.0
HEAT_SEVERE_C = 40.0


def _level(score: int) -> str:
    if score < LOW_MAX:
        return "low"
    if score <= MEDIUM_MAX:
        return "medium"
    return "high"


def get_working_risk(
    weather: str = "clear",
    temperature_c: float = 33.0,
    visibility_m: float = 10_000.0,
    ground: str = "dry",
    hours_on_shift: float = 0.0,
    fatigue_score: float = 0.0,
) -> dict:
    """Score 0-100 for how hazardous it is to be working right now.

    Returns {"score": int, "level": "low|medium|high", "reasons": [str, ...]}.
    """
    score = 10
    reasons: list[str] = []

    weather_points = {
        "clear": 0, "wind": 8, "heat": 12, "fog": 18, "rain": 25,
    }
    pts = weather_points.get(weather, 0)
    if pts:
        score += pts
        reasons.append(
            {"rain": "Heavy rain", "fog": "Fog", "heat": "Extreme heat",
             "wind": "High wind"}[weather]
        )

    if visibility_m < 500:
        score += 18
        reasons.append(f"Low visibility ({visibility_m:.0f} m)")
    elif visibility_m < 2_000:
        score += 8
        reasons.append(f"Reduced visibility ({visibility_m:.0f} m)")

    ground_points = {"dry": 0, "wet": 10, "muddy": 18}
    pts = ground_points.get(ground, 0)
    if pts:
        score += pts
        reasons.append({"wet": "Wet ground", "muddy": "Muddy ground - reduced traction"}[ground])

    if temperature_c >= HEAT_SEVERE_C:
        score += 15
        reasons.append(f"Severe heat ({temperature_c:.0f} C) - hydrate every 20 min")
    elif temperature_c >= HEAT_WARN_C:
        score += 8
        reasons.append(f"High heat ({temperature_c:.0f} C) - hydration reminder")

    if hours_on_shift >= 9:
        score += 15
        reasons.append(f"{hours_on_shift:.0f} h on shift")
    elif hours_on_shift >= 7:
        score += 8
        reasons.append(f"{hours_on_shift:.0f} h on shift")

    if fatigue_score >= 0.75:
        score += 20
        reasons.append("Operator showing signs of fatigue")
    elif fatigue_score >= 0.5:
        score += 10
        reasons.append("Operator alertness dropping")

    score = int(min(max(score, 0), 100))
    if not reasons:
        reasons.append("Conditions normal")
    return {"score": score, "level": _level(score), "reasons": reasons}
