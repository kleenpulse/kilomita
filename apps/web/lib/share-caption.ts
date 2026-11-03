import type { ShareCard } from "./share-code";

/*
 * The share row's caption, apart from the share code itself so the home page can show it without
 * loading the code (which comes with import() after a result). A test keeps the two in step.
 */

/** What each card field is called in the caption. */
export const CARD_FIELD_WORDS: Readonly<Record<keyof ShareCard, string>> = {
  downloadMbps: "speeds",
  uploadMbps: "speeds",
  latencyMs: "latency",
  grade: "grade",
  isp: "network",
  state: "state",
  day: "day",
};

export const SHARE_CAPTION =
  "Shares a link with your speeds, latency, grade, network, state and the day.";
