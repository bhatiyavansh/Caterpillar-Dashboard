/**
 * Small vector/quaternion helpers for the physics layer.
 *
 * Kept free of three.js so the physics world runs headless (Node checks,
 * a future worker) exactly as it runs in the browser.
 *
 * Orientation convention matches the render rig (chassis.ts): the machine's
 * world rotation is Ry(-heading) · Rx(pitch) · Rz(-roll), with heading
 * clockwise from north (-Z), pitch positive nose-up and roll positive
 * right-side-down.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

export function qAxis(axis: "x" | "y" | "z", angle: number): Quat {
  const s = Math.sin(angle / 2);
  const c = Math.cos(angle / 2);
  return { x: axis === "x" ? s : 0, y: axis === "y" ? s : 0, z: axis === "z" ? s : 0, w: c };
}

/** Rotates v by unit quaternion q. */
export function qRotate(q: Quat, v: V3): V3 {
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Machine attitude -> world rotation. */
export function attitudeToQuat(heading: number, pitch: number, roll: number): Quat {
  return qMul(qMul(qAxis("y", -heading), qAxis("x", pitch)), qAxis("z", -roll));
}

/** World rotation -> machine heading, pitch and roll (exact inverse of the above). */
export function quatToAttitude(q: Quat): { heading: number; pitch: number; roll: number } {
  const f = qRotate(q, { x: 0, y: 0, z: -1 });
  const r = qRotate(q, { x: 1, y: 0, z: 0 });
  const pitch = Math.asin(clamp1(f.y));
  const cp = Math.cos(pitch);
  const roll = cp > 1e-4 ? Math.asin(clamp1(-r.y / cp)) : 0;
  let heading = Math.atan2(f.x, -f.z);
  if (heading < 0) heading += Math.PI * 2;
  return { heading, pitch, roll };
}

/** Angle between the body's up axis and world up, radians. */
export function tiltOf(q: Quat): number {
  return Math.acos(clamp1(qRotate(q, { x: 0, y: 1, z: 0 }).y));
}

function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export function rotX(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

export function rotY(v: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

export function add(a: V3, b: V3): V3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
