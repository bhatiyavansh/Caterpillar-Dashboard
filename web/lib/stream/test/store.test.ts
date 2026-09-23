import assert from "node:assert/strict";
import { test } from "node:test";
import { siteToPlan, siteToTwin, twinToSite } from "../geo";
import { MAX_EVENTS, createStreamStore, initialState, reduce } from "../store";
import { TWIN_COMMANDS, toTelemetry } from "../twin";

const env = { seq: 1, epoch: "E", hub_ts: new Date().toISOString() };

test("machine update replaces only that machine (selector stability)", () => {
  const store = createStreamStore();
  const m = (id: string, fuel: number) => ({ type: "machine_state", ...env, machine_id: id, pos: { x: 0, y: 0, lat: 0, lon: 0 }, fuel_level_pct: fuel });
  store.setState(reduce(store.getState(), m("A", 1) as never, 0)!);
  store.setState(reduce(store.getState(), m("B", 1) as never, 0)!);
  const a = store.getState().machines.A;
  store.setState(reduce(store.getState(), m("B", 2) as never, 0)!);
  assert.equal(store.getState().machines.A, a, "untouched machine keeps its identity");
  assert.equal(store.getState().machines.B.fuel_level_pct, 2);
});

test("event log is bounded and seatbelt_fastened clears the active alert", () => {
  let s = initialState();
  const ev = (rseq: number, event: string, severity = "high") => ({ type: "event", ...env, rseq, id: `e${rseq}`, ts: "t", event, severity, machine_id: "EXC001", source: "rules", message: "", data: {} });
  s = { ...s, ...reduce(s, ev(1, "seatbelt_unfastened") as never, 0) };
  assert.equal(s.activeAlerts.length, 1);
  s = { ...s, ...reduce(s, ev(2, "seatbelt_fastened", "info") as never, 0) };
  assert.equal(s.activeAlerts.length, 0);
  for (let i = 3; i < MAX_EVENTS + 20; i++) s = { ...s, ...reduce(s, ev(i, "v2i_suggestion", "info") as never, 0) };
  assert.equal(s.events.length, MAX_EVENTS);
  assert.equal(s.events.at(-1)!.rseq, MAX_EVENTS + 19);
});

test("geo converters", () => {
  assert.deepEqual(siteToPlan({ x: 200, y: 150 }), { x: 0, z: 0 });
  const corner = siteToPlan({ x: 400, y: 300 });
  assert.ok(Math.abs(corner.x - 110) < 1e-9 && Math.abs(corner.z - 82.5) < 1e-9);
  const t = siteToTwin({ x: 210, y: 160 });
  assert.deepEqual(t, { x: 10, z: -10 }); // north of centre -> negative z in the twin
  assert.deepEqual(twinToSite(t.x, t.z), { x: 210, y: 160 });
});

test("contract -> twin telemetry never invents values", () => {
  const t = toTelemetry({
    type: "machine_state", ts: "t", machine_id: "DOZ001", model: "D6", machine_type: "dozer", operator_id: "OP1004",
    status: "travelling", pos: { x: 230, y: 150, lat: 0, lon: 0 }, heading_deg: 90, speed_mps: 1.5, intent: "reverse",
    engine_on: true, engine_hours: 1, fuel_level_pct: 70, fuel_used_l: 1, load_cycles: 1, idle_min: 0, seatbelt: "fastened",
    boom_angle_deg: 0, stick_angle_deg: 0, swing_angle_deg: 0, payload_kg: 0, hydraulic_temp_c: 70, coolant_temp_c: 80,
    pitch_deg: 0, roll_deg: 0, tip_over_margin: 3, bubble: "green", nearest_person_m: 99, fatigue_score: 0,
    fault_codes: [], zone: "A", task_id: null, task_progress: 0, task_eta_min: 0,
  });
  assert.equal(t.machineId, "DZR001");
  assert.equal(t.speed, -1.5, "reverse -> negative speed");
  assert.ok(Math.abs(t.heading - Math.PI / 2) < 1e-9);
  assert.ok(Number.isNaN(t.engineRpm), "rpm is not in the contract");
  assert.equal(t.nearestPerson, Number.POSITIVE_INFINITY);
  assert.equal(t.activity, "traveling");
  assert.deepEqual(Object.keys(TWIN_COMMANDS).sort(), ["dozer_reversing", "heavy_lift", "hydraulic_spike", "rain", "reset", "worker_behind"]);
});
