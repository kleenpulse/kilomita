import type { CountBand, MedianRange, NetworkTypeSlug, StatsWindow } from "@kilomita/shared";
import { COUNT_BANDS, ISPS, NIGERIAN_STATES } from "@kilomita/shared/lists";
import { TYPE_LABEL } from "./network-labels";

// Values arrive already rounded by the server (2 significant figures, whole ms); these only print.

const number = (value: number) => value.toLocaleString("en-NG", { maximumFractionDigits: 3 });

export const formatMbps = (value: number) => `${number(value)} Mbps`;
export const formatMs = (value: number) => `${number(value)} ms`;
export const formatRange = ([low, high]: MedianRange) => `${number(low)}–${number(high)}`;

export function bandLabel(band: CountBand): string {
  const [low, high] = band.split(/[-+]/);
  return high
    ? `${number(Number(low))}–${number(Number(high))} results`
    : `${number(Number(low))}+ results`;
}

export const isFewResults = (band: CountBand) =>
  COUNT_BANDS.find((entry) => entry.band === band)?.few ?? false;

export const ispName = (slug: string) => ISPS.find((isp) => isp.slug === slug)?.name ?? slug;
export const stateName = (slug: string) =>
  NIGERIAN_STATES.find((state) => state.slug === slug)?.name ?? slug;
export const typeLabel = (slug: string) =>
  slug in TYPE_LABEL ? TYPE_LABEL[slug as NetworkTypeSlug] : slug;

export const windowLabel = (days: StatsWindow) => `Last ${String(days)} days`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-03" → "3 Nov". */
export function dayLabel(key: string): string {
  const [, month, day] = key.split("-").map(Number);
  return `${String(day)} ${MONTHS[(month ?? 1) - 1] ?? ""}`;
}

/** "7" → "07:00". */
export const hourLabel = (key: string) => `${key.padStart(2, "0")}:00`;

/** Where the numbers come from: the real database, or memory stores (test rows or demo data). */
export type InsightsSource = "real" | "test" | "sample";

/** The filters a page shows (the server's StatsFilter has the same shape). */
export interface FilterValues {
  isp?: string;
  state?: string;
  type?: string;
  window?: StatsWindow;
}

/** A 3-hour block by its first hour: "21" → "21:00–00:00". */
export const blockLabel = (key: string) =>
  `${hourLabel(key)}–${hourLabel(String((Number(key) + 3) % 24))}`;
