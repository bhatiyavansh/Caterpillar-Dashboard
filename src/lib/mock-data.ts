import type {
  Alert,
  DiagnosticSystem,
  InspectionStepData,
  Machine,
  MachineNotification,
  MaintenanceTask,
  Operator,
  TaskItem,
  Worksite,
} from "./types";

export const PRIMARY_MACHINE_ID = "CAT-320-014";

export const machines: Machine[] = [
  {
    id: PRIMARY_MACHINE_ID,
    name: "CAT 320",
    type: "Hydraulic Excavator",
    model: "320 GC / 2023",
    location: "Sector B · North Bench",
    operator: "Alex Mercer",
    operatingHours: 4218,
    fuelLevel: 67,
    engineTemperature: 82,
    hydraulicPressure: 3200,
    health: "healthy",
    utilisation: 78,
    lastService: "12 Aug 2026",
    nextService: "04 Oct 2026",
    nextServiceHours: 42,
    image: "excavator",
  },
  {
    id: "CAT-950-007",
    name: "CAT 950",
    type: "Wheel Loader",
    model: "950 GC / 2022",
    location: "Sector A · Stockpile",
    operator: "Priya Raman",
    operatingHours: 7640,
    fuelLevel: 44,
    engineTemperature: 88,
    hydraulicPressure: 2950,
    health: "warning",
    utilisation: 64,
    lastService: "02 Sep 2026",
    nextService: "27 Sep 2026",
    nextServiceHours: 18,
    image: "loader",
  },
  {
    id: "CAT-CS56B-002",
    name: "CAT CS56B",
    type: "Soil Compactor",
    model: "CS56B / 2021",
    location: "Sector C · Haul Road",
    operator: "Dan Whitfield",
    operatingHours: 3112,
    fuelLevel: 81,
    engineTemperature: 79,
    hydraulicPressure: 2400,
    health: "healthy",
    utilisation: 51,
    lastService: "30 Jul 2026",
    nextService: "18 Oct 2026",
    nextServiceHours: 120,
    image: "compactor",
  },
  {
    id: "CAT-D6-011",
    name: "CAT D6",
    type: "Track-Type Dozer",
    model: "D6 XE / 2023",
    location: "Sector D · Overburden",
    operator: "Marco Silva",
    operatingHours: 2890,
    fuelLevel: 18,
    engineTemperature: 91,
    hydraulicPressure: 3350,
    health: "critical",
    utilisation: 83,
    lastService: "21 Aug 2026",
    nextService: "24 Sep 2026",
    nextServiceHours: 4,
    image: "dozer",
  },
  {
    id: "CAT-336-005",
    name: "CAT 336",
    type: "Hydraulic Excavator",
    model: "336 / 2024",
    location: "Sector B · South Face",
    operator: "Ines Duarte",
    operatingHours: 1560,
    fuelLevel: 92,
    engineTemperature: 77,
    hydraulicPressure: 3420,
    health: "healthy",
    utilisation: 71,
    lastService: "05 Sep 2026",
    nextService: "02 Nov 2026",
    nextServiceHours: 210,
    image: "excavator",
  },
  {
    id: "CAT-966-009",
    name: "CAT 966",
    type: "Wheel Loader",
    model: "966 GC / 2022",
    location: "Sector A · Crusher Feed",
    operator: "Tom Aldridge",
    operatingHours: 6105,
    fuelLevel: 57,
    engineTemperature: 85,
    hydraulicPressure: 3050,
    health: "warning",
    utilisation: 69,
    lastService: "18 Aug 2026",
    nextService: "29 Sep 2026",
    nextServiceHours: 26,
    image: "loader",
  },
];

export const fleetSummary = {
  activeMachines: 24,
  activeDelta: 3,
  healthy: 18,
  warning: 4,
  critical: 2,
  maintenanceDue: 6,
  criticalAlerts: 2,
};

export const alerts: Alert[] = [
  {
    id: "ALR-2041",
    severity: "critical",
    machineId: "CAT-D6-011",
    machineName: "CAT D6",
    title: "Engine coolant temperature above range",
    description: "Engine coolant temperature above recommended range. Sustained 104°C for 6 minutes under heavy load.",
    recommendedAction: "Idle the machine, inspect radiator core for blockage and verify coolant level once cooled.",
    timestamp: "Today · 09:42",
    system: "Cooling",
    acknowledged: false,
  },
  {
    id: "ALR-2040",
    severity: "critical",
    machineId: "CAT-D6-011",
    machineName: "CAT D6",
    title: "Fuel level critically low",
    description: "Fuel level at 18% with an estimated 2.4 operating hours remaining at current consumption.",
    recommendedAction: "Schedule refuelling before the next production cycle.",
    timestamp: "Today · 09:10",
    system: "Fuel",
    acknowledged: false,
  },
  {
    id: "ALR-2038",
    severity: "warning",
    machineId: PRIMARY_MACHINE_ID,
    machineName: "CAT 320",
    title: "Hydraulic filter service approaching",
    description: "Hydraulic return filter reaches its service interval in 42 operating hours.",
    recommendedAction: "Add the hydraulic filter to the next scheduled service window.",
    timestamp: "Today · 08:27",
    system: "Hydraulics",
    acknowledged: false,
  },
  {
    id: "ALR-2037",
    severity: "warning",
    machineId: "CAT-950-007",
    machineName: "CAT 950",
    title: "Fuel level below 20%",
    description: "Fuel level dropped below the 20% site threshold during the morning shift.",
    recommendedAction: "Dispatch the service truck to Sector A stockpile.",
    timestamp: "Today · 07:55",
    system: "Fuel",
    acknowledged: true,
  },
  {
    id: "ALR-2036",
    severity: "warning",
    machineId: "CAT-966-009",
    machineName: "CAT 966",
    title: "Transmission oil temperature elevated",
    description: "Transmission oil temperature trending 8°C above the seven-day average.",
    recommendedAction: "Reduce continuous ramp loading and re-check at end of shift.",
    timestamp: "Today · 07:31",
    system: "Transmission",
    acknowledged: false,
  },
  {
    id: "ALR-2035",
    severity: "info",
    machineId: PRIMARY_MACHINE_ID,
    machineName: "CAT 320",
    title: "Daily inspection completed",
    description: "Operator Alex Mercer completed the daily walkaround inspection with no issues found.",
    recommendedAction: "No action required.",
    timestamp: "Today · 07:04",
    system: "Operations",
    acknowledged: true,
  },
  {
    id: "ALR-2034",
    severity: "info",
    machineId: "CAT-336-005",
    machineName: "CAT 336",
    title: "Firmware update applied",
    description: "Display module firmware updated to 4.2.1 during the overnight window.",
    recommendedAction: "No action required.",
    timestamp: "Yesterday · 23:12",
    system: "Electrical",
    acknowledged: true,
  },
];

export const maintenanceTasks: MaintenanceTask[] = [
  {
    id: "MT-501",
    machineId: PRIMARY_MACHINE_ID,
    machineName: "CAT 320",
    title: "500-hour service",
    status: "upcoming",
    dueInHours: 42,
    date: "04 Oct 2026",
    technician: "R. Okafor",
    items: [
      { label: "Engine oil and filter", done: true },
      { label: "Hydraulic system inspection", done: true },
      { label: "Hydraulic return filter", done: false },
      { label: "Air filter primary element", done: false },
      { label: "Track tension check", done: false },
    ],
  },
  {
    id: "MT-502",
    machineId: "CAT-D6-011",
    machineName: "CAT D6",
    title: "Cooling system inspection",
    status: "overdue",
    dueInHours: -12,
    date: "20 Sep 2026",
    technician: "S. Nowak",
    items: [
      { label: "Radiator core cleaning", done: false },
      { label: "Coolant concentration test", done: false },
      { label: "Fan drive belt", done: false },
    ],
  },
  {
    id: "MT-503",
    machineId: "CAT-950-007",
    machineName: "CAT 950",
    title: "250-hour service",
    status: "upcoming",
    dueInHours: 18,
    date: "27 Sep 2026",
    technician: "R. Okafor",
    items: [
      { label: "Engine oil and filter", done: false },
      { label: "Axle oil level", done: false },
      { label: "Greasing schedule", done: true },
    ],
  },
  {
    id: "MT-504",
    machineId: "CAT-966-009",
    machineName: "CAT 966",
    title: "Transmission oil sample",
    status: "upcoming",
    dueInHours: 26,
    date: "29 Sep 2026",
    technician: "L. Fernandes",
    items: [
      { label: "S·O·S fluid sample", done: false },
      { label: "Transmission filter", done: false },
    ],
  },
  {
    id: "MT-505",
    machineId: "CAT-336-005",
    machineName: "CAT 336",
    title: "1000-hour service",
    status: "completed",
    dueInHours: 0,
    date: "05 Sep 2026",
    technician: "S. Nowak",
    items: [
      { label: "Engine oil and filter", done: true },
      { label: "Fuel filters", done: true },
      { label: "Hydraulic oil", done: true },
      { label: "Undercarriage inspection", done: true },
    ],
  },
  {
    id: "MT-506",
    machineId: "CAT-CS56B-002",
    machineName: "CAT CS56B",
    title: "Drum bearing greasing",
    status: "completed",
    dueInHours: 0,
    date: "30 Jul 2026",
    technician: "L. Fernandes",
    items: [
      { label: "Drum bearings", done: true },
      { label: "Vibratory system check", done: true },
    ],
  },
];

export const maintenanceTimeline = [
  { date: "20 Sep 2026", machine: "CAT D6", title: "Cooling system inspection", state: "overdue" as const },
  { date: "24 Sep 2026", machine: "CAT D6", title: "Coolant replacement", state: "upcoming" as const },
  { date: "27 Sep 2026", machine: "CAT 950", title: "250-hour service", state: "upcoming" as const },
  { date: "29 Sep 2026", machine: "CAT 966", title: "Transmission oil sample", state: "upcoming" as const },
  { date: "04 Oct 2026", machine: "CAT 320", title: "500-hour service", state: "upcoming" as const },
  { date: "05 Sep 2026", machine: "CAT 336", title: "1000-hour service", state: "completed" as const },
];

export const diagnosticSystems: DiagnosticSystem[] = [
  {
    id: "engine",
    name: "Engine",
    status: "healthy",
    summary: "All engine parameters within nominal operating envelope.",
    sensors: [
      { label: "Engine speed", value: "1,850 RPM", status: "healthy" },
      { label: "Oil pressure", value: "62 PSI", status: "healthy" },
      { label: "Intake manifold temp", value: "48 °C", status: "healthy" },
      { label: "Boost pressure", value: "18 PSI", status: "healthy" },
    ],
    codes: [],
    history: buildSeries(78, 6, 84),
  },
  {
    id: "hydraulics",
    name: "Hydraulics",
    status: "warning",
    summary: "Implement pump pressure reading intermittently outside expected range.",
    sensors: [
      { label: "System pressure", value: "3,200 PSI", status: "healthy" },
      { label: "Pump 1 pressure", value: "3,410 PSI", status: "warning" },
      { label: "Oil temperature", value: "88 °C", status: "warning" },
      { label: "Return filter Δp", value: "1.8 bar", status: "warning" },
    ],
    codes: [
      {
        code: "E1234",
        system: "Hydraulics",
        description: "Hydraulic pressure sensor reading outside expected range.",
        severity: "warning",
        occurrences: 4,
        firstSeen: "Today · 08:12",
        recommendedChecks: [
          "Inspect pressure sensor harness for chafing at the pump bulkhead.",
          "Verify implement pump standby pressure against spec (3,050–3,350 PSI).",
          "Replace hydraulic return filter if Δp remains above 1.5 bar.",
        ],
      },
    ],
    history: buildSeries(3100, 180, 3400),
  },
  {
    id: "transmission",
    name: "Transmission",
    status: "healthy",
    summary: "Swing and travel drives reporting normal torque and temperature.",
    sensors: [
      { label: "Travel motor temp", value: "71 °C", status: "healthy" },
      { label: "Swing brake", value: "Released", status: "healthy" },
      { label: "Drive oil level", value: "Nominal", status: "healthy" },
    ],
    codes: [],
    history: buildSeries(68, 5, 74),
  },
  {
    id: "electrical",
    name: "Electrical",
    status: "healthy",
    summary: "Charging system and CAN bus stable across all modules.",
    sensors: [
      { label: "Battery voltage", value: "27.8 V", status: "healthy" },
      { label: "Alternator output", value: "94 A", status: "healthy" },
      { label: "CAN bus errors", value: "0 / hr", status: "healthy" },
    ],
    codes: [],
    history: buildSeries(27.4, 0.4, 28.2),
  },
  {
    id: "cooling",
    name: "Cooling",
    status: "warning",
    summary: "Coolant temperature trending above the seven-day average under load.",
    sensors: [
      { label: "Coolant temperature", value: "92 °C", status: "warning" },
      { label: "Fan speed", value: "2,240 RPM", status: "healthy" },
      { label: "Radiator Δt", value: "11 °C", status: "warning" },
    ],
    codes: [
      {
        code: "E0761",
        system: "Cooling",
        description: "Coolant temperature high — derate threshold approaching.",
        severity: "warning",
        occurrences: 2,
        firstSeen: "Today · 09:02",
        recommendedChecks: [
          "Clean radiator and oil cooler cores of dust build-up.",
          "Check fan drive operation across the full speed range.",
        ],
      },
    ],
    history: buildSeries(86, 5, 94),
  },
  {
    id: "fuel",
    name: "Fuel",
    status: "healthy",
    summary: "Fuel delivery pressure and DEF dosing operating normally.",
    sensors: [
      { label: "Rail pressure", value: "1,420 bar", status: "healthy" },
      { label: "DEF level", value: "74 %", status: "healthy" },
      { label: "Water in fuel", value: "Not detected", status: "healthy" },
    ],
    codes: [],
    history: buildSeries(1400, 40, 1450),
  },
  {
    id: "safety",
    name: "Safety",
    status: "healthy",
    summary: "Object detection, cameras and lockout systems fully operational.",
    sensors: [
      { label: "Proximity radar", value: "Active", status: "healthy" },
      { label: "Cameras online", value: "4 / 4", status: "healthy" },
      { label: "Seatbelt interlock", value: "Engaged", status: "healthy" },
    ],
    codes: [],
    history: buildSeries(100, 0, 100),
  },
];

function buildSeries(base: number, spread: number, peak: number) {
  const points = 24;
  return Array.from({ length: points }, (_, i) => {
    const wave = Math.sin((i / points) * Math.PI * 2) * spread;
    const ramp = (i / points) * (peak - base) * 0.6;
    return {
      t: `${String(i).padStart(2, "0")}:00`,
      value: Number((base + wave + ramp).toFixed(1)),
    };
  });
}

export const engineTempSeries = buildSeries(76, 4, 92);
export const hydraulicSeries = buildSeries(3050, 140, 3400);

export const fuelSeries = Array.from({ length: 12 }, (_, i) => ({
  t: `${8 + i}:00`,
  litres: Number((18 + Math.sin(i / 2) * 4 + i * 0.35).toFixed(1)),
}));

export const operatingHoursSeries = [
  { day: "Mon", hours: 8.4, idle: 1.6 },
  { day: "Tue", hours: 9.1, idle: 1.2 },
  { day: "Wed", hours: 7.8, idle: 2.1 },
  { day: "Thu", hours: 9.6, idle: 0.9 },
  { day: "Fri", hours: 8.9, idle: 1.4 },
  { day: "Sat", hours: 5.2, idle: 0.7 },
  { day: "Sun", hours: 2.1, idle: 0.3 },
];

export const utilisationSeries = machines.map((m) => ({
  machine: m.name,
  utilisation: m.utilisation,
  idle: 100 - m.utilisation,
}));

export const alertTrendSeries = [
  { day: "Mon", critical: 1, warning: 4, info: 6 },
  { day: "Tue", critical: 0, warning: 6, info: 5 },
  { day: "Wed", critical: 2, warning: 3, info: 7 },
  { day: "Thu", critical: 1, warning: 5, info: 4 },
  { day: "Fri", critical: 0, warning: 2, info: 8 },
  { day: "Sat", critical: 1, warning: 3, info: 3 },
  { day: "Sun", critical: 2, warning: 4, info: 2 },
];

export const maintenanceFrequencySeries = [
  { month: "Apr", scheduled: 8, unscheduled: 2 },
  { month: "May", scheduled: 11, unscheduled: 3 },
  { month: "Jun", scheduled: 9, unscheduled: 1 },
  { month: "Jul", scheduled: 12, unscheduled: 4 },
  { month: "Aug", scheduled: 10, unscheduled: 2 },
  { month: "Sep", scheduled: 7, unscheduled: 3 },
];

export const machineEvents = [
  { time: "09:42", label: "Hydraulic pressure slightly elevated", severity: "warning" as const },
  { time: "08:27", label: "Scheduled inspection due in 42 operating hours", severity: "info" as const },
  { time: "07:55", label: "Fuel level low on paired machine CAT 950", severity: "warning" as const },
  { time: "07:04", label: "Operator started machine", severity: "info" as const },
  { time: "06:58", label: "Pre-start diagnostics passed", severity: "info" as const },
];

export const inspectionSteps: InspectionStepData[] = [
  {
    id: "engine",
    title: "Check engine compartment",
    instruction:
      "Inspect the engine compartment for leaks, loose components or unusual debris. Confirm belts are intact and the area is free of build-up.",
    shape: "excavator",
    checkpoints: ["No oil or coolant leaks", "Belts intact and tensioned", "No debris on hot surfaces"],
  },
  {
    id: "hydraulics",
    title: "Check hydraulic system",
    instruction:
      "Walk the boom and stick. Look for weeping cylinders, damaged hoses and confirm the hydraulic oil sight glass is within range.",
    shape: "excavator",
    checkpoints: ["Cylinders dry", "Hoses free of abrasion", "Oil level in sight glass"],
  },
  {
    id: "tracks",
    title: "Check tracks and undercarriage",
    instruction:
      "Inspect track tension, idlers and rollers. Remove packed material and confirm no cracked or missing shoes.",
    shape: "dozer",
    checkpoints: ["Track sag within 30–40 mm", "No packed material", "Rollers free of leaks"],
  },
  {
    id: "fluids",
    title: "Check fluids",
    instruction:
      "Verify engine oil, coolant, DEF and fuel levels. Top up any fluid below the minimum mark before starting work.",
    shape: "fluids",
    checkpoints: ["Engine oil at full mark", "Coolant above minimum", "DEF above 20%"],
  },
  {
    id: "safety",
    title: "Check safety equipment",
    instruction:
      "Confirm the fire extinguisher, seatbelt, mirrors, cameras and travel alarm are present and functional.",
    shape: "safety",
    checkpoints: ["Extinguisher charged", "Seatbelt latches", "Travel alarm audible", "Cameras clean"],
  },
];

export const taskItems: TaskItem[] = [
  {
    id: "TSK-01",
    title: "Daily inspection",
    description: "Complete the full pre-start walkaround for CAT 320.",
    status: "in-progress",
    assignee: "Alex Mercer",
    machineId: PRIMARY_MACHINE_ID,
    due: "Today · 07:30",
    priority: "high",
  },
  {
    id: "TSK-02",
    title: "Check hydraulic fluid",
    description: "Verify hydraulic oil level in the sight glass and record the reading.",
    status: "pending",
    assignee: "Alex Mercer",
    machineId: PRIMARY_MACHINE_ID,
    due: "Today · 08:00",
    priority: "high",
  },
  {
    id: "TSK-03",
    title: "Check engine oil",
    description: "Confirm engine oil is between the min and max marks on the dipstick.",
    status: "completed",
    assignee: "Alex Mercer",
    machineId: PRIMARY_MACHINE_ID,
    due: "Today · 07:10",
    priority: "medium",
  },
  {
    id: "TSK-04",
    title: "Check tracks and undercarriage",
    description: "Measure track sag and clear packed material from the sprockets.",
    status: "pending",
    assignee: "Marco Silva",
    machineId: "CAT-D6-011",
    due: "Today · 10:00",
    priority: "medium",
  },
  {
    id: "TSK-05",
    title: "Check safety equipment",
    description: "Fire extinguisher, seatbelt, travel alarm and beacon verification.",
    status: "completed",
    assignee: "Priya Raman",
    machineId: "CAT-950-007",
    due: "Today · 07:20",
    priority: "high",
  },
  {
    id: "TSK-06",
    title: "Clean camera sensors",
    description: "Wipe the four perimeter camera lenses and verify the 360° stitch.",
    status: "in-progress",
    assignee: "Alex Mercer",
    machineId: PRIMARY_MACHINE_ID,
    due: "Today · 11:00",
    priority: "low",
  },
  {
    id: "TSK-07",
    title: "Verify attachments",
    description: "Confirm quick coupler lock engagement and bucket pin retention.",
    status: "pending",
    assignee: "Ines Duarte",
    machineId: "CAT-336-005",
    due: "Today · 12:30",
    priority: "high",
  },
  {
    id: "TSK-08",
    title: "Record fuel burn",
    description: "Log end-of-shift fuel figures into the site production sheet.",
    status: "pending",
    assignee: "Tom Aldridge",
    machineId: "CAT-966-009",
    due: "Today · 15:00",
    priority: "low",
  },
];

export const operator: Operator = {
  name: "Alex Mercer",
  id: "OP-4821",
  shift: "07:00 – 15:00",
  machineId: PRIMARY_MACHINE_ID,
  operatingTimeToday: "5h 42m",
  tasksCompleted: 8,
  tasksTotal: 10,
  safetyStatus: "good",
  certifications: ["Excavator Class 3", "Confined space", "Site induction 2026", "First aid"],
};

export const worksite: Worksite = {
  name: "Northgate Quarry",
  sector: "Sector B",
  machines: [
    { id: PRIMARY_MACHINE_ID, name: "CAT 320", x: 48, y: 52, self: true, health: "healthy" },
    { id: "CAT-950-007", name: "CAT 950", x: 22, y: 30, health: "warning" },
    { id: "CAT-D6-011", name: "CAT D6", x: 74, y: 66, health: "critical" },
    { id: "CAT-336-005", name: "CAT 336", x: 62, y: 28, health: "healthy" },
    { id: "CAT-CS56B-002", name: "CAT CS56B", x: 34, y: 76, health: "healthy" },
  ],
  restrictedZones: [{ id: "rz1", label: "Blast zone", x: 66, y: 12, w: 26, h: 22 }],
  workAreas: [
    { id: "wa1", label: "North bench", x: 38, y: 40, w: 30, h: 26 },
    { id: "wa2", label: "Haul road", x: 8, y: 62, w: 34, h: 12 },
  ],
};

export const machineNotifications: MachineNotification[] = [
  { id: "N1", title: "Daily inspection pending", body: "Track inspection step is still outstanding.", severity: "warning", time: "08:42", read: false },
  { id: "N2", title: "Hydraulic temperature increased", body: "Hydraulic oil is 6°C above the shift average.", severity: "warning", time: "08:21", read: false },
  { id: "N3", title: "Maintenance reminder", body: "500-hour service due in 42 operating hours.", severity: "info", time: "07:50", read: false },
  { id: "N4", title: "Low fuel on paired machine", body: "CAT 950 in Sector A has dropped below 20%.", severity: "info", time: "07:31", read: true },
  { id: "N5", title: "New work assignment", body: "Trench line 4B released for excavation.", severity: "info", time: "07:05", read: true },
];

export const assistantChecks = [
  { label: "Engine inspection", done: true },
  { label: "Hydraulic inspection", done: true },
  { label: "Fuel check", done: true },
  { label: "Track inspection", done: false },
];

export const cameraDetections: Record<
  string,
  { label: string; distance: number; x: number; y: number; critical: boolean }[]
> = {
  front: [{ label: "Worker", distance: 2.8, x: 42, y: 58, critical: true }],
  rear: [
    { label: "Haul truck", distance: 9.4, x: 62, y: 44, critical: false },
    { label: "Cone barrier", distance: 5.1, x: 24, y: 62, critical: false },
  ],
  left: [{ label: "Spoil pile", distance: 3.6, x: 55, y: 60, critical: false }],
  right: [],
  "360": [
    { label: "Worker", distance: 2.8, x: 50, y: 22, critical: true },
    { label: "Haul truck", distance: 9.4, x: 70, y: 70, critical: false },
  ],
};
