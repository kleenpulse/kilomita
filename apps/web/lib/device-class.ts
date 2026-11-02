import type { DeviceClass } from "@kilomita/shared";

export interface DeviceSignals {
  /** navigator.userAgentData.mobile (Chromium only). */
  mobile?: boolean;
  /** (pointer: coarse) matches: the main input is a finger. */
  coarsePointer: boolean;
  /** The shorter side of the screen, in CSS pixels. */
  shortSide: number;
}

/** Coarse on purpose: three classes, from signals that say nothing else about the device. */
export function deviceClass({ mobile, coarsePointer, shortSide }: DeviceSignals): DeviceClass {
  if (mobile === true) return "mobile";
  if (!coarsePointer) return "desktop";
  return shortSide >= 600 ? "tablet" : "mobile";
}

export function readDeviceClass(): DeviceClass {
  const ua = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return deviceClass({
    ...(ua?.mobile === undefined ? {} : { mobile: ua.mobile }),
    coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    shortSide: Math.min(window.screen.width, window.screen.height),
  });
}
