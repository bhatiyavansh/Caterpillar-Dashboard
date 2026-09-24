"use client";

/**
 * React side of `announceStatus`: any component that renders a red or amber
 * sign calls this with what it is showing, and the sound follows.
 *
 * It lives in the status primitives rather than in each screen on purpose. A
 * screen can forget to wire up a sound; a chip that cannot render amber without
 * announcing it cannot.
 */
import * as React from "react";
import { announceStatus, levelOf, unlockAlertSound, type StatusLevel } from "@/lib/alert-sound";

export function useStatusSound(key: string | undefined, level: StatusLevel): void {
  React.useEffect(() => {
    unlockAlertSound();
  }, []);

  React.useEffect(() => {
    if (!key) return;
    announceStatus(key, level);
  }, [key, level]);
}

/** The same, for callers holding one of the product's status strings. */
export function useStatusSoundFor(key: string | undefined, status: string | null | undefined): void {
  useStatusSound(key, levelOf(status));
}
