export type HealthStatus = "healthy" | "warning" | "critical" | "offline";
export type Severity = "critical" | "warning" | "info";
export type MachineMode = "idle" | "operating" | "heavy-load" | "maintenance";
export type SimulationScenario = "normal" | "warning" | "critical";

export interface SensorData {
  engineTemperature: number; // °C
  fuelLevel: number; // %
  fuelLitres: number; // L
  hydraulicPressure: number; // PSI
  hydraulicTemperature: number; // °C
  rpm: number;
  battery: number; // %
  defLevel: number; // %
  oilPressure: number; // PSI
  coolantTemperature: number; // °C
  operatingHours: number;
  machineSpeed: number; // km/h
  engineLoad: number; // %
}

export interface Machine {
  id: string;
  name: string;
  type: string;
  model: string;
  location: string;
  operator: string;
  operatingHours: number;
  fuelLevel: number;
  engineTemperature: number;
  hydraulicPressure: number;
  health: HealthStatus;
  utilisation: number;
  lastService: string;
  nextService: string;
  nextServiceHours: number;
  image: MachineShape;
}

export type MachineShape = "excavator" | "loader" | "dozer" | "compactor";

export interface Alert {
  id: string;
  severity: Severity;
  machineId: string;
  machineName: string;
  title: string;
  description: string;
  recommendedAction: string;
  timestamp: string;
  system: string;
  acknowledged: boolean;
}

export interface MaintenanceTask {
  id: string;
  machineId: string;
  machineName: string;
  title: string;
  status: "upcoming" | "overdue" | "completed";
  dueInHours: number;
  date: string;
  technician: string;
  items: { label: string; done: boolean }[];
}

export interface InspectionStepData {
  id: string;
  title: string;
  instruction: string;
  shape: MachineShape | "fluids" | "safety";
  checkpoints: string[];
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  status: "pending" | "in-progress" | "completed";
  assignee: string;
  machineId: string;
  due: string;
  priority: "low" | "medium" | "high";
}

export interface Operator {
  name: string;
  id: string;
  shift: string;
  machineId: string;
  operatingTimeToday: string;
  tasksCompleted: number;
  tasksTotal: number;
  safetyStatus: "good" | "review" | "action";
  certifications: string[];
}

export interface DiagnosticCode {
  code: string;
  system: string;
  description: string;
  severity: Severity;
  occurrences: number;
  firstSeen: string;
  recommendedChecks: string[];
}

export interface DiagnosticSystem {
  id: string;
  name: string;
  status: HealthStatus;
  summary: string;
  sensors: { label: string; value: string; status: HealthStatus }[];
  codes: DiagnosticCode[];
  history: { t: string; value: number }[];
}

export interface Worksite {
  name: string;
  sector: string;
  machines: {
    id: string;
    name: string;
    x: number;
    y: number;
    self?: boolean;
    health: HealthStatus;
  }[];
  restrictedZones: { id: string; label: string; x: number; y: number; w: number; h: number }[];
  workAreas: { id: string; label: string; x: number; y: number; w: number; h: number }[];
}

export interface MachineNotification {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  time: string;
  read: boolean;
}
