import type { SensorData, Severity } from "./types";

export interface AdviceItem {
  id: string;
  severity: Severity;
  title: string;
  body: string;
}

/**
 * Turns raw sensor values into the short, actionable statements the in-cab
 * assistant shows. Deterministic so the dashboard and the cab agree.
 */
export function deriveAdvice(s: SensorData): AdviceItem[] {
  const items: AdviceItem[] = [];

  if (s.hydraulicTemperature >= 100) {
    items.push({
      id: "hyd-crit",
      severity: "critical",
      title: `Hydraulic temperature critical at ${s.hydraulicTemperature.toFixed(0)}°C.`,
      body: "Stop high-load work now and allow the system to cool before continuing.",
    });
  } else if (s.hydraulicTemperature >= 90) {
    items.push({
      id: "hyd-warn",
      severity: "warning",
      title: `Hydraulic temperature is slightly elevated at ${s.hydraulicTemperature.toFixed(0)}°C.`,
      body: "Consider reducing continuous high-load operation for the next few minutes.",
    });
  }

  if (s.engineTemperature >= 104) {
    items.push({
      id: "eng-crit",
      severity: "critical",
      title: `Engine temperature ${s.engineTemperature.toFixed(0)}°C — above derate threshold.`,
      body: "Idle the engine and check the radiator core for dust build-up.",
    });
  } else if (s.engineTemperature >= 92) {
    items.push({
      id: "eng-warn",
      severity: "warning",
      title: `Engine running warm at ${s.engineTemperature.toFixed(0)}°C.`,
      body: "Monitor coolant temperature and avoid sustained full-load cycles.",
    });
  }

  const hoursLeft = ((s.fuelLevel / 100) * 640) / 26;
  if (s.fuelLevel <= 10) {
    items.push({
      id: "fuel-crit",
      severity: "critical",
      title: `Fuel level is ${s.fuelLevel.toFixed(0)}%.`,
      body: `Estimated operating time remaining: ${hoursLeft.toFixed(1)} hours. Refuel before the next cycle.`,
    });
  } else if (s.fuelLevel <= 20) {
    items.push({
      id: "fuel-warn",
      severity: "warning",
      title: `Fuel level is ${s.fuelLevel.toFixed(0)}%.`,
      body: `Estimated operating time remaining: ${hoursLeft.toFixed(1)} hours.`,
    });
  }

  if (s.hydraulicPressure >= 3650) {
    items.push({
      id: "press-crit",
      severity: "critical",
      title: `Hydraulic pressure ${Math.round(s.hydraulicPressure).toLocaleString()} PSI is above the safe envelope.`,
      body: "Release the implement load and have the relief valve checked.",
    });
  }

  if (s.defLevel <= 20) {
    items.push({
      id: "def",
      severity: "warning",
      title: `DEF level is ${s.defLevel.toFixed(0)}%.`,
      body: "Top up diesel exhaust fluid to avoid an engine derate.",
    });
  }

  items.push({
    id: "service",
    severity: "info",
    title: "Maintenance is due in 42 operating hours.",
    body: "500-hour service scheduled for 04 Oct 2026 with technician R. Okafor.",
  });

  return items;
}
