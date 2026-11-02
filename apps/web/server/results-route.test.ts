import { ENGINE_VERSION } from "@kilomita/engine";
import { SHARING } from "@kilomita/shared";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { results } from "./db/schema";
import { GENUINE_RESULT } from "./fixtures";
import { LIMITS } from "./limits";
import { handleCorrect, handleDelete, handleSubmit } from "./results-route";
import type { SharingDeps, Stores } from "./stores";
import { TEST_KEY, jsonRequest, secret, testDeps, testStores } from "./testing";
import { issueToken, ownerHash } from "./token";

const ISSUED = Date.UTC(2026, 10, 2, 12);
let time: number;
let stores: Stores;
let deps: SharingDeps;
const now = () => time;

beforeEach(async () => {
  time = ISSUED;
  stores = await testStores(now);
  deps = testDeps(stores, now, "x-real-ip");
});

/** A token issued now, then the clock moved past a plausible run. */
function token(low = true): string {
  const { token: value } = issueToken(TEST_KEY, { low, ev: GENUINE_RESULT.engineVersion }, time);
  time += 20_000;
  return value;
}

const submit = (body: unknown, headers: Record<string, string> = {}, using = deps) =>
  handleSubmit(jsonRequest("POST", "/api/results", body, headers), using);

async function rows() {
  return stores.db.select().from(results).orderBy(results.createdAt);
}

describe("POST /api/results", () => {
  it("stores a shared result, without any IP, and answers its id", async () => {
    const response = await submit(
      { token: token(), secret: secret(), result: GENUINE_RESULT },
      { "x-real-ip": "102.88.85.10" },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { id } = (await response.json()) as { id: string };
    const [row] = await rows();
    expect(row?.id).toBe(id);
    expect(row).toMatchObject({ ispSlug: "mtn", stateSlug: "lagos", flag: null, lowData: true });
    expect(row?.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("102.88");
  });

  it("stores no IP hash when no header is trusted", async () => {
    const response = await submit(
      { token: token(), secret: secret(), result: GENUINE_RESULT },
      { "x-real-ip": "102.88.85.10" },
      { ...deps, trustedHeader: undefined },
    );
    expect(response.status).toBe(201);
    expect((await rows())[0]?.ipHash).toBeNull();
  });

  it("answers a retry with the same token and secret with the same id, and stores it once", async () => {
    const body = { token: token(), secret: secret(), result: GENUINE_RESULT };
    const first = await submit(body);
    const again = await submit(body);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(await first.json());
    expect(await rows()).toHaveLength(1);
  });

  it("refuses a used token with another secret", async () => {
    const value = token();
    expect((await submit({ token: value, secret: secret(), result: GENUINE_RESULT })).status).toBe(
      201,
    );
    const reuse = await submit({ token: value, secret: secret(), result: GENUINE_RESULT });
    expect(reuse.status).toBe(409);
    expect(await rows()).toHaveLength(1);
  });

  it("burns nothing when the insert fails: the retry goes through", async () => {
    let fail = true;
    const flaky = new Proxy(stores.db, {
      get(target, property, receiver) {
        if (property === "insert" && fail) {
          fail = false;
          throw new Error("connection lost");
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const body = { token: token(), secret: secret(), result: GENUINE_RESULT };
    await expect(submit(body, {}, { ...deps, stores: { ...stores, db: flaky } })).rejects.toThrow();
    expect((await submit(body)).status).toBe(201);
  });

  it("refuses forged, edited and expired tokens before anything else", async () => {
    const forged = `v1.${Buffer.from("{}").toString("base64url")}.AAAA`;
    expect((await submit({ token: forged, secret: secret(), result: GENUINE_RESULT })).status).toBe(
      401,
    );
    expect((await submit({ secret: secret(), result: GENUINE_RESULT })).status).toBe(401);
    const old = token();
    time = ISSUED + SHARING.tokenTtlMs;
    const expired = await submit({ token: old, secret: secret(), result: GENUINE_RESULT });
    expect(expired.status).toBe(410);
    expect(await rows()).toHaveLength(0);
  });

  it("allows only five attempts per token", async () => {
    const value = token();
    for (let i = 0; i < LIMITS.submitAttemptsPerToken; i++) {
      expect((await submit({ token: value, secret: "short", result: GENUINE_RESULT })).status).toBe(
        400,
      );
    }
    const sixth = await submit({ token: value, secret: secret(), result: GENUINE_RESULT });
    expect(sixth.status).toBe(429);
  });

  it("refuses a tab loaded before an engine bump: its new token carries the new version", async () => {
    // What POST /api/tokens issues after a deploy, against a result from the old page's engine.
    const { token: fresh } = issueToken(TEST_KEY, { low: true, ev: ENGINE_VERSION }, time);
    time += 20_000;
    const stale = { ...GENUINE_RESULT, engineVersion: "0.2.0" };
    const response = await submit({ token: fresh, secret: secret(), result: stale });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "engine-mismatch" });
  });

  it("refuses impossible results with the reason", async () => {
    const forged = {
      ...GENUINE_RESULT,
      loadedLatency: { ...GENUINE_RESULT.loadedLatency, grade: "D" },
    };
    const response = await submit({ token: token(), secret: secret(), result: forged });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "grade-mismatch" });
    const mismatch = await submit({
      token: token(false),
      secret: secret(),
      result: GENUINE_RESULT,
    });
    expect(await mismatch.json()).toEqual({ error: "profile-mismatch" });
    expect(await rows()).toHaveLength(0);
  });

  it("stores an unusual result flagged rather than refusing it", async () => {
    const odd = { ...GENUINE_RESULT, durationMs: 200 };
    expect((await submit({ token: token(), secret: secret(), result: odd })).status).toBe(201);
    expect((await rows())[0]?.flag).toBe("implausible");
  });

  it("flags a replayed result from the same connection on the same day", async () => {
    const ip = { "x-real-ip": "102.88.85.10" };
    expect(
      (await submit({ token: token(), secret: secret(), result: GENUINE_RESULT }, ip)).status,
    ).toBe(201);
    expect(
      (await submit({ token: token(), secret: secret(), result: GENUINE_RESULT }, ip)).status,
    ).toBe(201);
    const other = { "x-real-ip": "105.112.1.1" };
    expect(
      (await submit({ token: token(), secret: secret(), result: GENUINE_RESULT }, other)).status,
    ).toBe(201);
    expect((await rows()).map((row) => row.flag)).toEqual([null, "duplicate", null]);
  });

  it("refuses bad bodies", async () => {
    expect((await submit("{not json")).status).toBe(400);
    expect(
      (
        await submit({
          token: token(),
          secret: secret(),
          result: { ...GENUINE_RESULT, ispSlug: "nope" },
        })
      ).status,
    ).toBe(400);
    const huge = {
      token: token(),
      secret: secret(),
      result: GENUINE_RESULT,
      pad: "x".repeat(9_000),
    };
    expect((await submit(huge)).status).toBe(413);
  });

  it("is unavailable without stores or a usable key", async () => {
    const body = { token: token(), secret: secret(), result: GENUINE_RESULT };
    expect((await submit(body, {}, { ...deps, stores: null })).status).toBe(503);
    expect((await submit(body, {}, { ...deps, key: null })).status).toBe(503);
  });

  it("says when results live only in memory", async () => {
    const memory = { ...deps, stores: { ...stores, memory: true } };
    const response = await submit(
      { token: token(), secret: secret(), result: GENUINE_RESULT },
      {},
      memory,
    );
    expect(response.headers.get("x-kilomita-stores")).toBe("memory");
    const real = await submit({ token: token(), secret: secret(), result: GENUINE_RESULT });
    expect(real.headers.get("x-kilomita-stores")).toBeNull();
  });
});

async function shared(): Promise<{ id: string; owner: string }> {
  const owner = secret();
  const response = await submit({ token: token(), secret: owner, result: GENUINE_RESULT });
  const { id } = (await response.json()) as { id: string };
  return { id, owner };
}

const correct = (id: string, body: unknown) =>
  handleCorrect(jsonRequest("PATCH", `/api/results/${id}`, body), id, deps);

describe("PATCH /api/results/:id", () => {
  it("lets the owner correct the network details for 30 minutes", async () => {
    const { id, owner } = await shared();
    const response = await correct(id, { secret: owner, ispSlug: "glo", stateSlug: null });
    expect(response.status).toBe(200);
    const [row] = await rows();
    expect(row).toMatchObject({ ispSlug: "glo", stateSlug: null, networkType: "4g" });
    expect(row?.correctedAt?.getTime()).toBe(time);
    time += SHARING.correctionWindowMs;
    expect((await correct(id, { secret: owner, networkType: "5g" })).status).toBe(404);
  });

  it("answers 404 to anyone but the owner, and for unknown ids", async () => {
    const { id } = await shared();
    expect((await correct(id, { secret: secret(), ispSlug: "glo" })).status).toBe(404);
    expect(
      (await correct("00000000-0000-4000-8000-000000000000", { secret: secret(), ispSlug: "glo" }))
        .status,
    ).toBe(404);
    expect((await correct("../etc", { secret: secret(), ispSlug: "glo" })).status).toBe(404);
    expect((await rows())[0]?.ispSlug).toBe("mtn");
  });

  it("refuses corrections of anything but the network details", async () => {
    const { id, owner } = await shared();
    expect((await correct(id, { secret: owner, downloadMbps: 900 })).status).toBe(400);
    expect((await correct(id, { secret: owner })).status).toBe(400);
  });

  it("limits corrections per result", async () => {
    const { id, owner } = await shared();
    for (let i = 0; i < LIMITS.correctionsPerResult; i++) {
      expect((await correct(id, { secret: owner, networkType: "4g" })).status).toBe(200);
    }
    expect((await correct(id, { secret: owner, networkType: "4g" })).status).toBe(429);
  });
});

const remove = (secrets: string[]) =>
  handleDelete(jsonRequest("DELETE", "/api/results", { secrets }), deps);

describe("DELETE /api/results", () => {
  it("deletes exactly the results whose secrets are sent", async () => {
    const a = await shared();
    const b = await shared();
    const c = await shared();
    const response = await remove([a.owner, c.owner, secret()]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 2 });
    expect((await rows()).map((row) => row.id)).toEqual([b.id]);
    expect(await (await remove([a.owner])).json()).toEqual({ deleted: 0 });
  });

  it("takes at most one batch per request", async () => {
    const batch = Array.from({ length: SHARING.deleteBatch + 1 }, secret);
    expect((await remove(batch)).status).toBe(400);
    expect((await remove(batch.slice(1))).status).toBe(200);
  });

  it("has a global ceiling per minute", async () => {
    const minute = Math.floor(time / 60_000);
    for (let i = 0; i < LIMITS.deletesPerMinute; i++) {
      await stores.kv.countInWindow(`deletes:${String(minute)}`, (minute + 1) * 60_000);
    }
    expect((await remove([secret()])).status).toBe(429);
    time = (minute + 1) * 60_000;
    expect((await remove([secret()])).status).toBe(200);
  });

  it("keeps only hashes: the stored owner is the SHA-256 of the secret", async () => {
    const { id, owner } = await shared();
    const [row] = await stores.db.select().from(results).where(eq(results.id, id));
    expect(row?.ownerHash).toBe(ownerHash(owner));
    expect(JSON.stringify(row)).not.toContain(owner);
  });
});
