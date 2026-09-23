"""Site constants, machine specifications and the fleet roster.

Machine parameters are hackathon-grade approximations of real Cat models.
Units: kg, metres, m/s, litres/hour, degrees Celsius.
"""

from __future__ import annotations

from dataclasses import dataclass, field

SEED = 42
TICK_S = 1.0

# --- site frame -----------------------------------------------------------
SITE_X_MAX = 400.0
SITE_Y_MAX = 300.0
ORIGIN_LAT = 13.0827          # Chennai
ORIGIN_LON = 80.2707
METRES_PER_DEG_LAT = 111_320.0

# --- economics ------------------------------------------------------------
DIESEL_PRICE_INR = 90.0       # per litre
CO2_KG_PER_LITRE = 2.68

# --- shift ----------------------------------------------------------------
SHIFT_START_HOUR = 8
SHIFT_HOURS = 10

# --- safety thresholds ----------------------------------------------------
BUBBLE_RED_BASE_M = 5.0
BUBBLE_AMBER_BASE_M = 10.0
TIP_OVER_AMBER = 1.5
TIP_OVER_RED = 1.2
EVENT_DEBOUNCE_S = 10.0
SEATBELT_ESCALATE_S = 5.0
V2V_SCAN_RADIUS_M = 40.0
V2V_HORIZON_S = 5.0
V2V_DEBOUNCE_S = 10.0


@dataclass(frozen=True)
class MachineSpec:
    model: str
    machine_type: str
    mass_kg: float
    max_payload_kg: float
    working_fuel_lph: float
    idle_fuel_lph: float
    max_speed_mps: float
    tank_l: float
    # geometry (excavator-relevant; other types keep defaults)
    boom_len: float = 5.7
    stick_len: float = 2.9
    track_half_length: float = 2.2
    track_half_width: float = 1.4
    cog_height: float = 1.5
    counterweight_mass: float = 4_000.0
    counterweight_arm: float = 2.5
    bucket_mass: float = 1_200.0
    arm_mass: float = 2_500.0
    bucket_m3: float = 1.2
    cycle_s: float = 22.0


SPECS: dict[str, MachineSpec] = {
    "320": MachineSpec(
        model="320", machine_type="excavator",
        mass_kg=22_000, max_payload_kg=2_500,
        working_fuel_lph=16.0, idle_fuel_lph=3.5, max_speed_mps=1.5, tank_l=410,
        bucket_m3=1.2, cycle_s=22.0,
    ),
    "950": MachineSpec(
        model="950", machine_type="wheel_loader",
        mass_kg=19_000, max_payload_kg=6_000,
        working_fuel_lph=18.0, idle_fuel_lph=4.0, max_speed_mps=10.0, tank_l=290,
        bucket_m3=3.5, cycle_s=35.0,
        track_half_length=2.6, track_half_width=1.6,
    ),
    "D6": MachineSpec(
        model="D6", machine_type="dozer",
        mass_kg=23_000, max_payload_kg=0,
        working_fuel_lph=20.0, idle_fuel_lph=4.0, max_speed_mps=3.0, tank_l=430,
        bucket_m3=3.0, cycle_s=45.0,
        track_half_length=2.8, track_half_width=1.5,
    ),
    "745": MachineSpec(
        model="745", machine_type="truck",
        mass_kg=30_000, max_payload_kg=41_000,
        working_fuel_lph=25.0, idle_fuel_lph=5.0, max_speed_mps=15.0, tank_l=620,
        bucket_m3=25.0, cycle_s=60.0,
        track_half_length=4.0, track_half_width=1.8,
    ),
    "140": MachineSpec(
        model="140", machine_type="grader",
        mass_kg=16_000, max_payload_kg=0,
        working_fuel_lph=14.0, idle_fuel_lph=3.0, max_speed_mps=12.0, tank_l=340,
        bucket_m3=0.0, cycle_s=90.0,
        track_half_length=3.2, track_half_width=1.3,
    ),
}


@dataclass(frozen=True)
class FleetEntry:
    machine_id: str
    model: str
    operator_id: str
    role: str
    home_zone: str


FLEET: tuple[FleetEntry, ...] = (
    FleetEntry("EXC001", "320", "OP1001", "trench", "B"),
    FleetEntry("EXC002", "320", "OP1002", "excavate", "A"),
    FleetEntry("WHL001", "950", "OP1003", "load", "C"),
    FleetEntry("DOZ001", "D6", "OP1004", "push", "A"),
    FleetEntry("TRK001", "745", "OP1005", "haul", "road"),
    FleetEntry("TRK002", "745", "OP1006", "haul", "road"),
    FleetEntry("TRK003", "745", "OP1007", "haul", "road"),
    FleetEntry("TRK004", "745", "OP1008", "haul", "road"),
    FleetEntry("GRD001", "140", "OP1009", "grade", "C"),
)

HERO_MACHINE = "EXC001"


@dataclass(frozen=True)
class OperatorProfile:
    operator_id: str
    name: str
    skill: str            # novice | intermediate | expert
    years_experience: float


OPERATORS: tuple[OperatorProfile, ...] = (
    OperatorProfile("OP1001", "Ravi Shankar", "intermediate", 6.0),
    OperatorProfile("OP1002", "Meera Nair", "expert", 12.0),
    OperatorProfile("OP1003", "Arun Kumar", "expert", 14.0),
    OperatorProfile("OP1004", "Suresh Babu", "intermediate", 7.5),
    OperatorProfile("OP1005", "Priya Raman", "intermediate", 5.0),
    OperatorProfile("OP1006", "Karthik Iyer", "novice", 1.5),
    OperatorProfile("OP1007", "Divya Menon", "expert", 10.0),
    OperatorProfile("OP1008", "Vignesh Rao", "novice", 2.0),
    OperatorProfile("OP1009", "Lakshmi Devi", "intermediate", 8.0),
    OperatorProfile("OP1010", "Anand Pillai", "novice", 0.5),   # spare / trainee
)

SKILL_CYCLE_FACTOR = {"novice": 1.30, "intermediate": 1.00, "expert": 0.85}
SKILL_HARSH_PROB = {"novice": 0.18, "intermediate": 0.06, "expert": 0.02}

WORKER_IDS = ("W01", "W02", "W03", "W04", "W05", "W06")

# --- environment ----------------------------------------------------------
WEATHER_TYPES = ("clear", "rain", "fog", "heat", "wind")
WEATHER_FACTOR = {"clear": 1.00, "heat": 1.08, "wind": 1.05, "rain": 1.20, "fog": 1.12}
SOIL_FACTOR = {"sand": 0.90, "mixed": 1.00, "clay": 1.15, "rock": 1.40}
SKILL_FACTOR = {"expert": 0.85, "intermediate": 1.00, "novice": 1.30}

# base production rate by task_type x model (units per hour)
BASE_RATE: dict[tuple[str, str], float] = {
    ("trenching", "320"): 55.0,      # m3/h
    ("loading", "950"): 6.0,         # trucks/h
    ("loading", "320"): 4.0,
    ("grading", "140"): 1_400.0,     # m2/h
    ("dozing", "D6"): 90.0,          # m3/h
    ("hauling", "745"): 8.0,         # loads/h
}
DEFAULT_BASE_RATE = 50.0

AMBIENT_TEMP_C = 33.0
