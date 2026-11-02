import { ISPS, NIGERIAN_STATES } from "@kilomita/shared/lists";
import type { Detection } from "./detection";

/** The line above the network selectors: what was detected, and what to do about it. */
export function networkNote(detection: Detection | "pending" | null): string {
  if (detection === "pending") return "Checking your network…";
  const isp = ISPS.find((entry) => entry.slug === detection?.isp);
  const state = NIGERIAN_STATES.find((entry) => entry.slug === detection?.state);
  if (isp?.slug === "other") return "We couldn't match your network. Choose it below.";
  if (isp && state)
    return `We think you're on ${isp.name} in ${state.name}. Not right? Correct it below.`;
  if (isp) return `We think you're on ${isp.name}. Not right? Correct it below.`;
  if (state) return `We think you're in ${state.name}. Choose your network below.`;
  return "Choose your network and state so this result is labelled correctly.";
}
