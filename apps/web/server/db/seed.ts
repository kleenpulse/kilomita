import { createHash } from "node:crypto";
import type { IspSlug, NetworkTypeSlug } from "@kilomita/shared";
import { NIGERIAN_STATES } from "@kilomita/shared/lists";
import { GENUINE_RESULT } from "../fixtures";
import type { Db } from "./database";
import { type NewResultRow, results } from "./schema";

/*
 * Synthetic demo results for memory mode only (KILOMITA_STORES=memory with KILOMITA_SEED=demo):
 * the dashboard needs data to render in development and e2e, and every page then says it shows
 * sample data. Never real measurements, never written to a real database (createStores reaches
 * this only in memory mode). Deterministic for a given `now`, so e2e sees the same groups.
 *
 * Sizes are picked so the default 30-day window shows every case: ISPs with 500+ results, a few
 * hundred, 50-99 and 30-49 ("few results"), under 30 (hidden), and none at all.
 */

interface Profile {
  /** Results over 90 days, spread evenly: about a third fall in the last 30. */
  count: number;
  downloadMbps: number;
  uploadMbps: number;
  latencyMs: number;
  types: readonly (readonly [NetworkTypeSlug, number])[];
}

const MOBILE = [
  ["4g", 0.6],
  ["5g", 0.12],
  ["3g", 0.13],
  ["unknown", 0.15],
] as const;

const PROFILES: Partial<Record<IspSlug, Profile>> = {
  mtn: { count: 1800, downloadMbps: 22, uploadMbps: 8, latencyMs: 45, types: MOBILE },
  airtel: { count: 1650, downloadMbps: 21, uploadMbps: 7, latencyMs: 48, types: MOBILE },
  glo: { count: 500, downloadMbps: 9, uploadMbps: 3, latencyMs: 70, types: MOBILE },
  "9mobile": { count: 230, downloadMbps: 6, uploadMbps: 2, latencyMs: 80, types: MOBILE },
  spectranet: {
    count: 420,
    downloadMbps: 14,
    uploadMbps: 4,
    latencyMs: 55,
    types: [
      ["4g", 0.85],
      ["unknown", 0.15],
    ],
  },
  starlink: {
    count: 170,
    downloadMbps: 60,
    uploadMbps: 10,
    latencyMs: 48,
    types: [["satellite", 1]],
  },
  smile: { count: 120, downloadMbps: 12, uploadMbps: 4, latencyMs: 60, types: [["4g", 1]] },
  fiberone: { count: 60, downloadMbps: 45, uploadMbps: 40, latencyMs: 20, types: [["fiber", 1]] },
  tizeti: {
    count: 25,
    downloadMbps: 10,
    uploadMbps: 5,
    latencyMs: 35,
    types: [["fixed-wireless", 1]],
  },
  other: { count: 300, downloadMbps: 12, uploadMbps: 4, latencyMs: 65, types: MOBILE },
};

// Most shared results would come from a few big states; the rest spread over all 37.
const STATE_WEIGHTS: readonly (readonly [string, number])[] = [
  ["lagos", 0.3],
  ["fct", 0.12],
  ["rivers", 0.08],
  ["kano", 0.07],
  ["oyo", 0.06],
  ["kaduna", 0.05],
  ["ogun", 0.05],
  ["enugu", 0.04],
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** xorshift32: small, deterministic, good enough for synthetic data. */
function generator(seed: number) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
  const normal = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  function pick<T>(choices: readonly (readonly [T, number])[]): T | undefined {
    let roll = next();
    for (const [choice, weight] of choices) {
      if (roll < weight) return choice;
      roll -= weight;
    }
    return undefined;
  }
  return { next, normal, pick };
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const round = (value: number, places: number) => Number(value.toFixed(places));

export function demoRows(now: number): NewResultRow[] {
  const random = generator(20261103);
  const rows: NewResultRow[] = [];
  for (const [isp, profile] of Object.entries(PROFILES) as [IspSlug, Profile][]) {
    for (let i = 0; i < profile.count; i++) {
      const createdAt = new Date(now - 60_000 - random.next() * 90 * DAY_MS);
      // Evening peak in Lagos time (19:00-22:59): congested, so slower.
      const hour = (createdAt.getUTCHours() + 1) % 24;
      const peak = hour >= 19 && hour <= 22 ? 0.7 : 1;
      const idleMedianMs = round(profile.latencyMs * Math.exp(0.3 * random.normal()), 1);
      const lowData = random.next() < 0.5;
      const state =
        random.next() < 0.05
          ? null
          : (random.pick(STATE_WEIGHTS) ??
            NIGERIAN_STATES[Math.floor(random.next() * NIGERIAN_STATES.length)]?.slug ??
            "lagos");
      rows.push({
        createdAt,
        measuredAt: createdAt,
        downloadMbps: round(peak * profile.downloadMbps * Math.exp(0.5 * random.normal()), 2),
        uploadMbps: round(peak * profile.uploadMbps * Math.exp(0.5 * random.normal()), 2),
        idleMedianMs,
        idleP95Ms: round(idleMedianMs * 1.3, 1),
        jitterMs: round(idleMedianMs * 0.1, 1),
        requestLossPct: 0,
        // 40 ms added under load: grade B, as the engine's own rule gives.
        loadedDownloadMs: idleMedianMs + 40,
        loadedUploadMs: idleMedianMs + 35,
        grade: "B",
        bytesUsed: lowData ? 9_000_000 : 40_000_000,
        durationMs: lowData ? 12_000 : 25_000,
        lowData,
        engineVersion: GENUINE_RESULT.engineVersion,
        serverId: GENUINE_RESULT.serverId,
        ispSlug: isp,
        stateSlug: state,
        networkType: random.pick(profile.types) ?? "unknown",
        deviceClass: random.next() < 0.8 ? "mobile" : "desktop",
        tokenHash: hash(`demo-token-${isp}-${String(i)}`),
        ownerHash: hash(`demo-owner-${isp}-${String(i)}`),
        // A few flagged rows with absurd numbers: they must never reach an aggregate.
        flag: i < 4 ? (i % 2 === 0 ? "implausible" : "duplicate") : null,
        ...(i < 4 ? { downloadMbps: 900, idleMedianMs: 1 } : {}),
      });
    }
  }
  return rows;
}

export async function seedDemo(db: Db, now: number): Promise<number> {
  const rows = demoRows(now);
  for (let start = 0; start < rows.length; start += 500) {
    await db.insert(results).values(rows.slice(start, start + 500));
  }
  return rows.length;
}
