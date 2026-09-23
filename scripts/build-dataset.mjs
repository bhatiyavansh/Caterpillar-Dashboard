/**
 * Turns the raw `data/` dump into compact JSON the app can import.
 *
 * telemetry.csv alone is ~20 MB / 180k rows — far too much to ship to a
 * browser, and pointless to parse at runtime when every view wants aggregates.
 * This script streams it once and emits per-machine and per-day rollups, plus
 * the small reference tables and the replay tracks (transformed into the twin's
 * world coordinates) verbatim.
 *
 * Run with `npm run data:build`. Output is committed so `npm run dev` needs no
 * extra step.
 */

import { createReadStream } from "node:fs";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const OUT = path.join(ROOT, "src", "data", "generated");

/* --------------------------------------------------------------------- */
/*  Site frame                                                            */
/* --------------------------------------------------------------------- */

/**
 * The dataset's site spans roughly x 48..375, y 186..275 — a wide, shallow
 * strip. The twin's world is 260 m square centred on the origin, so we affine
 * map one onto the other. Kept here (and mirrored in src/lib/data/site-frame.ts)
 * so generated coordinates and runtime coordinates can never drift.
 */
export const SITE_FRAME = {
  originX: 211,
  originY: 230,
  scaleX: 0.68,
  scaleZ: 0.95,
};

const toWorldX = (x) => +(((x - SITE_FRAME.originX) * SITE_FRAME.scaleX).toFixed(2));
const toWorldZ = (y) => +(((y - SITE_FRAME.originY) * SITE_FRAME.scaleZ).toFixed(2));

/* --------------------------------------------------------------------- */
/*  Helpers                                                               */
/* --------------------------------------------------------------------- */

function parseCsv(file) {
  const text = readFileSync(path.join(DATA, file), "utf8").trim();
  const [head, ...lines] = text.split(/\r?\n/);
  const keys = head.split(",");
  return lines.map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    keys.forEach((k, i) => (row[k] = cells[i]));
    return row;
  });
}

/** Handles quoted cells — incident descriptions contain commas. */
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (n, p = 2) => +n.toFixed(p);
const dayOf = (timestamp) => String(timestamp).slice(0, 10);

/* --------------------------------------------------------------------- */
/*  Reference tables                                                      */
/* --------------------------------------------------------------------- */

const meta = JSON.parse(readFileSync(path.join(DATA, "meta.json"), "utf8"));

const machines = parseCsv("machines.csv").map((r) => ({
  machineId: r.machine_id,
  model: r.model,
  type: r.machine_type,
  engineHoursStart: num(r.engine_hours_start),
  commissionedDate: r.commissioned_date,
}));

const operators = parseCsv("operators.csv").map((r) => ({
  operatorId: r.operator_id,
  name: r.name,
  skill: r.skill,
  yearsExperience: num(r.years_experience),
  certifiedModels: r.certified_models.split("|"),
}));

const anomalies = parseCsv("anomaly_labels.csv").map((r) => ({
  date: r.date,
  machineId: r.machine_id,
  operatorId: r.operator_id,
  type: r.anomaly_type,
}));

const incidents = parseCsv("incidents.csv").map((r) => ({
  incidentId: r.incident_id,
  timestamp: r.timestamp,
  machineId: r.machine_id,
  operatorId: r.operator_id,
  type: r.type,
  severity: r.severity,
  zone: r.zone,
  weather: r.weather,
  description: r.description,
  // Both frames: raw for provenance, world for the 3D scene.
  x: num(r.x),
  y: num(r.y),
  worldX: toWorldX(num(r.x)),
  worldZ: toWorldZ(num(r.y)),
}));

const maintenance = parseCsv("maintenance.csv").map((r) => ({
  date: r.date,
  machineId: r.machine_id,
  hydraulicHealth: num(r.hydraulic_health),
  engineHealth: num(r.engine_health),
  undercarriageHealth: num(r.undercarriage_health),
  avgHydraulicTempC: num(r.avg_hydraulic_temp_c),
  oilAnalysisIndex: num(r.oil_analysis_index),
}));

/* --------------------------------------------------------------------- */
/*  Tasks                                                                 */
/* --------------------------------------------------------------------- */

const taskRows = parseCsv("tasks.csv");

const taskByMachine = new Map();
const taskByType = new Map();
const taskBySkill = new Map();

for (const r of taskRows) {
  const est = num(r.estimated_time_min);
  const act = num(r.actual_time_min);
  const bump = (map, key, extra = {}) => {
    const e = map.get(key) ?? { key, count: 0, estimated: 0, actual: 0, ...extra };
    e.count++;
    e.estimated += est;
    e.actual += act;
    map.set(key, e);
    return e;
  };
  bump(taskByMachine, r.machine_id);
  bump(taskByType, r.task_type);
  bump(taskBySkill, r.operator_skill);
}

const finishTask = (map) =>
  [...map.values()].map((e) => ({
    key: e.key,
    count: e.count,
    avgEstimatedMin: round(e.estimated / e.count, 1),
    avgActualMin: round(e.actual / e.count, 1),
    // > 1 means jobs run longer than planned.
    overrunRatio: round(e.actual / Math.max(e.estimated, 1e-6), 3),
  }));

/* --------------------------------------------------------------------- */
/*  Telemetry — streamed                                                  */
/* --------------------------------------------------------------------- */

async function aggregateTelemetry() {
  const perMachine = new Map();
  const perDay = new Map();
  const weather = new Map();
  let rows = 0;
  let firstTs = null;
  let lastTs = null;

  const blank = (id) => ({
    machineId: id,
    rows: 0,
    fuelL: 0,
    loadCycles: 0,
    idleMin: 0,
    hydSum: 0,
    coolSum: 0,
    speedSum: 0,
    maxPayload: 0,
    payloadSum: 0,
    seatbeltViolations: 0,
    harshSwings: 0,
    engineHoursMin: Infinity,
    engineHoursMax: -Infinity,
  });

  const rl = createInterface({
    input: createReadStream(path.join(DATA, "telemetry.csv")),
    crlfDelay: Infinity,
  });

  let keys = null;
  for await (const line of rl) {
    if (!line) continue;
    if (!keys) {
      keys = line.split(",");
      continue;
    }
    const c = line.split(",");
    const get = (k) => c[keys.indexOf(k)];

    const id = get("machine_id");
    const ts = get("timestamp");
    const day = dayOf(ts);
    rows++;
    if (!firstTs || ts < firstTs) firstTs = ts;
    if (!lastTs || ts > lastTs) lastTs = ts;

    const hyd = num(get("hydraulic_temp_c"));
    const cool = num(get("coolant_temp_c"));
    const fuel = num(get("fuel_used_l"));
    const cycles = num(get("load_cycles"));
    const idle = num(get("idle_min"));
    const payload = num(get("payload_kg"));
    const speed = num(get("speed_mps"));
    const hours = num(get("engine_hours"));
    const belted = get("seatbelt") !== "Fastened";
    const harsh = get("harsh_swing") === "True";

    for (const map of [perMachine, perDay]) {
      const key = map === perMachine ? id : `${id}|${day}`;
      const e = map.get(key) ?? { ...blank(id), day: map === perDay ? day : undefined };
      e.rows++;
      e.fuelL += fuel;
      e.loadCycles += cycles;
      e.idleMin += idle;
      e.hydSum += hyd;
      e.coolSum += cool;
      e.speedSum += speed;
      e.payloadSum += payload;
      if (payload > e.maxPayload) e.maxPayload = payload;
      if (belted) e.seatbeltViolations++;
      if (harsh) e.harshSwings++;
      if (hours < e.engineHoursMin) e.engineHoursMin = hours;
      if (hours > e.engineHoursMax) e.engineHoursMax = hours;
      map.set(key, e);
    }

    const w = get("weather");
    weather.set(w, (weather.get(w) ?? 0) + 1);
  }

  const finish = (e) => ({
    machineId: e.machineId,
    ...(e.day ? { date: e.day } : {}),
    samples: e.rows,
    fuelL: round(e.fuelL, 1),
    loadCycles: e.loadCycles,
    idleMin: round(e.idleMin, 1),
    avgHydraulicC: round(e.hydSum / e.rows, 1),
    avgCoolantC: round(e.coolSum / e.rows, 1),
    avgSpeedMps: round(e.speedSum / e.rows, 3),
    avgPayloadKg: Math.round(e.payloadSum / e.rows),
    maxPayloadKg: Math.round(e.maxPayload),
    seatbeltViolations: e.seatbeltViolations,
    harshSwings: e.harshSwings,
    engineHours: round(e.engineHoursMax - e.engineHoursMin, 1),
    // Share of sampled minutes spent idling — the headline efficiency number.
    idleRatio: round(e.idleMin / Math.max(e.rows, 1), 3),
  });

  return {
    rows,
    firstTs,
    lastTs,
    perMachine: [...perMachine.values()].map(finish),
    perDay: [...perDay.values()].map(finish).sort((a, b) =>
      a.machineId === b.machineId
        ? a.date.localeCompare(b.date)
        : a.machineId.localeCompare(b.machineId),
    ),
    weather: [...weather.entries()].map(([k, v]) => ({ weather: k, samples: v })),
  };
}

/* --------------------------------------------------------------------- */
/*  Replays                                                               */
/* --------------------------------------------------------------------- */

function buildReplays() {
  const tracks = readdirSync(path.join(DATA, "incident_tracks"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const j = JSON.parse(readFileSync(path.join(DATA, "incident_tracks", f), "utf8"));
      return {
        incidentId: j.incident_id,
        machineId: j.machine_id,
        operatorId: j.operator_id,
        type: j.type,
        severity: j.severity,
        timestamp: j.timestamp,
        durationS: j.duration_s,
        frames: j.frames.map((fr) => ({
          t: fr.t,
          machines: fr.machines.map((m) => ({
            machineId: m.machine_id,
            x: toWorldX(m.x),
            z: toWorldZ(m.y),
            // Dataset bearings are degrees clockwise from north, same as ours.
            heading: round((m.heading_deg * Math.PI) / 180, 4),
            intent: m.intent,
            bubble: m.bubble,
          })),
          workers: fr.workers.map((w) => ({
            workerId: w.worker_id,
            x: toWorldX(w.x),
            z: toWorldZ(w.y),
          })),
        })),
      };
    })
    .sort((a, b) => a.incidentId.localeCompare(b.incidentId));

  const runs = readdirSync(path.join(DATA, "runs"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const j = JSON.parse(readFileSync(path.join(DATA, "runs", f), "utf8"));
      const DEG = Math.PI / 180;
      return {
        runId: j.run_id,
        operatorId: j.operator_id,
        skill: j.skill,
        machineId: j.machine_id,
        taskType: j.task_type,
        durationS: j.duration_s,
        cycles: j.cycles,
        cycleTimeS: j.cycle_time_s,
        frames: j.frames.map((fr) => ({
          t: fr.t,
          boomAngle: round(fr.boom_angle_deg * DEG, 4),
          stickAngle: round(fr.stick_angle_deg * DEG, 4),
          swingAngle: round(fr.swing_angle_deg * DEG, 4),
          payload: fr.payload_kg,
          cycleIndex: fr.cycle_index,
        })),
      };
    })
    .sort((a, b) => a.runId.localeCompare(b.runId));

  return { tracks, runs };
}

/* --------------------------------------------------------------------- */

async function main() {
  if (!existsSync(DATA)) {
    console.error(`No data/ directory at ${DATA}`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  console.log("streaming telemetry.csv …");
  const telemetry = await aggregateTelemetry();
  console.log(`  ${telemetry.rows.toLocaleString()} rows -> ${telemetry.perMachine.length} machines, ${telemetry.perDay.length} machine-days`);

  const replays = buildReplays();

  // Latest maintenance reading per machine, plus the full series for charts.
  const latestMaintenance = new Map();
  for (const m of maintenance) {
    const prev = latestMaintenance.get(m.machineId);
    if (!prev || m.date > prev.date) latestMaintenance.set(m.machineId, m);
  }

  const byType = new Map();
  const bySeverity = new Map();
  const byZone = new Map();
  for (const i of incidents) {
    byType.set(i.type, (byType.get(i.type) ?? 0) + 1);
    bySeverity.set(i.severity, (bySeverity.get(i.severity) ?? 0) + 1);
    byZone.set(i.zone, (byZone.get(i.zone) ?? 0) + 1);
  }

  const dataset = {
    meta: {
      ...meta,
      builtAt: new Date().toISOString(),
      siteFrame: SITE_FRAME,
      telemetryRows: telemetry.rows,
      telemetryFrom: telemetry.firstTs,
      telemetryTo: telemetry.lastTs,
    },
    machines,
    operators,
    anomalies,
    incidents,
    incidentSummary: {
      total: incidents.length,
      byType: [...byType.entries()].map(([k, v]) => ({ key: k, count: v })),
      bySeverity: [...bySeverity.entries()].map(([k, v]) => ({ key: k, count: v })),
      byZone: [...byZone.entries()].map(([k, v]) => ({ key: k, count: v })),
    },
    maintenance,
    maintenanceLatest: [...latestMaintenance.values()],
    telemetry: {
      perMachine: telemetry.perMachine,
      perDay: telemetry.perDay,
      weather: telemetry.weather,
    },
    tasks: {
      total: taskRows.length,
      byMachine: finishTask(taskByMachine),
      byType: finishTask(taskByType),
      bySkill: finishTask(taskBySkill),
    },
  };

  writeFileSync(path.join(OUT, "site-dataset.json"), JSON.stringify(dataset));
  writeFileSync(path.join(OUT, "replays.json"), JSON.stringify(replays));

  const kb = (f) =>
    (readFileSync(path.join(OUT, f)).byteLength / 1024).toFixed(0) + " KB";
  console.log(`wrote src/data/generated/site-dataset.json (${kb("site-dataset.json")})`);
  console.log(`wrote src/data/generated/replays.json (${kb("replays.json")})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
