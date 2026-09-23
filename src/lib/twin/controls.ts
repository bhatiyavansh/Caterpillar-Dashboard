/**
 * Keyboard -> operator intent.
 *
 * This is the only file in the twin that knows a keyboard exists. It converts
 * key state into the same neutral `VehicleInput` the mock IoT generator emits,
 * and nothing downstream can tell the difference.
 *
 * Held keys are ramped rather than applied instantly, which is the first half of
 * making the machine feel heavy (the second half is the accel limit in
 * `VehicleModel`).
 */

import type { VehicleInput } from "@/types/twin";
import { damp } from "./vehicle";

/** Physical key codes, so the layout works on AZERTY/QWERTZ too. */
const KEYS = {
  forward: "ArrowUp",
  back: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  boomUp: "KeyW",
  boomDown: "KeyS",
  stickCurl: "KeyA",
  stickExtend: "KeyD",
  bucketCurl: "KeyQ",
  bucketRelease: "KeyE",
  emergencyStop: "Space",
  reset: "KeyR",
} as const;

/** Live key state. Module-level so the Canvas driver can read it without props. */
const pressed = new Set<string>();

/** Smoothed drive axes — ramped toward the key state each frame. */
const axes = { throttle: 0, steer: 0, swing: 0 };

let shiftHeld = false;

export interface ControlHandlers {
  onEmergencyStop: () => void;
  onReset: () => void;
  onToggleDirector: () => void;
  onToggleHelp: () => void;
}

/** True while the operator is holding shift (swing modifier). */
export function isSwinging(): boolean {
  return shiftHeld && (pressed.has(KEYS.left) || pressed.has(KEYS.right));
}

/** Snapshot of which controls are active, for the on-screen key hints. */
export function activeKeys(): Set<string> {
  return pressed;
}

/**
 * Builds this frame's operator input.
 *
 * Shift re-targets left/right from tracks to upper-body swing, which is how the
 * real machine works: the house rotates independently of the undercarriage.
 */
export function readInput(dt: number): VehicleInput {
  const forward = pressed.has(KEYS.forward) ? 1 : 0;
  const back = pressed.has(KEYS.back) ? 1 : 0;

  const leftKey = pressed.has(KEYS.left) ? 1 : 0;
  const rightKey = pressed.has(KEYS.right) ? 1 : 0;

  // Shift + left/right swings the house instead of steering the tracks.
  const swinging = shiftHeld;
  const targetSteer = swinging ? 0 : rightKey - leftKey;
  const targetSwing = swinging ? rightKey - leftKey : 0;

  axes.throttle = damp(axes.throttle, forward - back, 7, dt);
  axes.steer = damp(axes.steer, targetSteer, 8, dt);
  axes.swing = damp(axes.swing, targetSwing, 8, dt);

  // Deadzone so a released key settles to a true zero.
  const dz = (v: number) => (Math.abs(v) < 0.004 ? 0 : v);

  return {
    throttle: dz(axes.throttle),
    steer: dz(axes.steer),
    swing: dz(axes.swing),
    boom:
      (pressed.has(KEYS.boomUp) ? 1 : 0) - (pressed.has(KEYS.boomDown) ? 1 : 0),
    stick:
      (pressed.has(KEYS.stickExtend) ? 1 : 0) - (pressed.has(KEYS.stickCurl) ? 1 : 0),
    bucket:
      (pressed.has(KEYS.bucketCurl) ? 1 : 0) - (pressed.has(KEYS.bucketRelease) ? 1 : 0),
    emergencyStop: false,
  };
}

/** Zeroes everything — used when the window loses focus mid-press. */
export function releaseAll(): void {
  pressed.clear();
  shiftHeld = false;
  axes.throttle = 0;
  axes.steer = 0;
  axes.swing = 0;
}

const HANDLED = new Set<string>(Object.values(KEYS));

/**
 * Attaches the listeners. Returns a detach function.
 *
 * Edge-triggered commands (e-stop, reset, panel toggles) fire on keydown via the
 * supplied handlers; continuous controls are polled from `readInput`.
 */
export function attachControls(handlers: ControlHandlers): () => void {
  /**
   * Whether the key belongs to the focused control rather than to the machine.
   *
   * Text fields are the obvious case. Buttons and links matter just as much:
   * Space and Enter activate a focused control, and `emergencyStop` is bound to
   * Space — so without this a keyboard user who tabs to any button on the page
   * would trigger an emergency stop instead of pressing the button.
   */
  const isTypingTarget = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
    if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
    const role = el.getAttribute?.("role");
    return role === "button" || role === "link" || role === "menuitem" || role === "tab";
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;

    shiftHeld = e.shiftKey;

    // Ctrl+D opens the director panel (and must not bookmark the page).
    if (e.ctrlKey && e.code === "KeyD") {
      e.preventDefault();
      handlers.onToggleDirector();
      return;
    }
    if (e.code === "Slash" && e.shiftKey) {
      e.preventDefault();
      handlers.onToggleHelp();
      return;
    }
    // Let other browser shortcuts through untouched.
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (HANDLED.has(e.code)) e.preventDefault();

    if (e.repeat) return;

    if (e.code === KEYS.emergencyStop) {
      handlers.onEmergencyStop();
      return;
    }
    if (e.code === KEYS.reset) {
      handlers.onReset();
      return;
    }

    pressed.add(e.code);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    shiftHeld = e.shiftKey;
    pressed.delete(e.code);
    if (HANDLED.has(e.code)) e.preventDefault();
  };

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp, { passive: false });
  window.addEventListener("blur", releaseAll);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", releaseAll);
    releaseAll();
  };
}

export { KEYS };
