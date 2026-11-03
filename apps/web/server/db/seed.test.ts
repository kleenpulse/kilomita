import { afterEach, describe, expect, it, vi } from "vitest";
import { groupStats } from "../stats";
import { createStores } from "../stores";
import { demoRows } from "./seed";
import { results } from "./schema";

const NOW = Date.UTC(2026, 10, 2, 12);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("demo seed", () => {
  it("is deterministic for a given time, and stays inside the last 90 days", () => {
    const rows = demoRows(NOW);
    expect(demoRows(NOW)).toEqual(rows);
    expect(rows.length).toBeGreaterThan(4000);
    const ages = rows.map((row) => NOW - (row.createdAt?.getTime() ?? 0));
    expect(Math.min(...ages)).toBeGreaterThan(0);
    expect(Math.max(...ages)).toBeLessThan(90 * 24 * 60 * 60 * 1000);
    expect(rows.some((row) => row.ispSlug === "ipnx")).toBe(false);
    expect(rows.filter((row) => row.flag !== null)).not.toHaveLength(0);
  });

  it("is never written without memory stores: KILOMITA_SEED alone does nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await createStores({ KILOMITA_SEED: "demo" })).toBeNull();
    const plain = await createStores({ KILOMITA_STORES: "memory" });
    expect(plain?.seeded).toBe(false);
    expect(await plain?.db.$count(results)).toBe(0);
  }, 60_000);

  it("fills memory stores with every case the dashboard shows, flagged rows left out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stores = await createStores({ KILOMITA_STORES: "memory", KILOMITA_SEED: "demo" });
    if (!stores) throw new Error("no stores");
    expect(stores.seeded).toBe(true);
    const cells = await groupStats(stores.db, "isp", {}, Date.now());
    const byIsp = Object.fromEntries(
      cells.map((cell) => [cell.key, cell.enough ? cell.nBand : "hidden"]),
    );
    expect(byIsp).toMatchObject({
      mtn: "500-999",
      airtel: "500-999",
      glo: "100-249",
      "9mobile": "50-99",
      smile: "30-49",
      fiberone: "hidden",
      tizeti: "hidden",
      ipnx: "hidden",
    });
    // The flagged rows claim 900 Mbps; no published number comes near it.
    const highest = Math.max(
      ...cells.flatMap((cell) => (cell.enough ? [cell.interval.downloadMbps[1]] : [])),
    );
    expect(highest).toBeLessThan(900);
  }, 60_000);
});
