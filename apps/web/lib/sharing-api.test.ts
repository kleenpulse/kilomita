import { SHARING } from "@kilomita/shared/lists";
import { describe, expect, it } from "vitest";
import {
  correctResult,
  deleteResults,
  requestTestServers,
  requestToken,
  submitResult,
} from "./sharing-api";

const answer =
  (status: number, body: unknown = {}): typeof fetch =>
  () =>
    Promise.resolve(Response.json(body, { status }));
const offline: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
const body = { token: "t", secret: "s".repeat(43), result: {} } as never;

describe("requestToken", () => {
  it("holds the token with its expiry counted on this device's clock", async () => {
    const held = await requestToken(
      true,
      () => 5_000,
      answer(200, { token: "v1.a.b", expiresAt: 1 }),
    );
    expect(held).toEqual({ value: "v1.a.b", expiresAt: 5_000 + SHARING.tokenTtlMs, lowData: true });
  });

  it("gives null, never an error, when sharing is unavailable", async () => {
    expect(await requestToken(true, Date.now, answer(503))).toBeNull();
    expect(await requestToken(true, Date.now, answer(429))).toBeNull();
    expect(await requestToken(true, Date.now, offline)).toBeNull();
    expect(await requestToken(true, Date.now, answer(200, { nope: 1 }))).toBeNull();
  });

  it("gives up after its timeout", async () => {
    const never: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    expect(await requestToken(true, Date.now, never, 10)).toBeNull();
  });
});

describe("requestTestServers", () => {
  const list = {
    servers: [{ id: "lagos-1", origin: "https://lagos-1.kilomita.com.ng" }],
    fallback: false,
    ticket: "k1.a.b",
  };

  it("answers the list as sent", async () => {
    expect(await requestTestServers(true, answer(200, list))).toEqual(list);
  });

  it("tells a per-address limit apart from every other failure", async () => {
    expect(await requestTestServers(true, answer(429, { error: "rate-limited" }))).toBe(
      "rate-limited",
    );
    expect(await requestTestServers(true, answer(429, { error: "busy" }))).toBeNull();
    expect(await requestTestServers(true, answer(503))).toBeNull();
    expect(await requestTestServers(true, offline)).toBeNull();
    expect(await requestTestServers(true, answer(200, { servers: "x" }))).toBeNull();
  });
});

describe("submitResult", () => {
  it("tells shared, refused and unknown apart", async () => {
    expect(await submitResult(body, answer(201, { id: "a" }))).toEqual({
      status: "shared",
      id: "a",
    });
    expect(await submitResult(body, answer(200, { id: "a" }))).toEqual({
      status: "shared",
      id: "a",
    });
    expect(await submitResult(body, answer(410))).toEqual({ status: "refused", reason: "too-old" });
    expect(await submitResult(body, answer(503))).toEqual({
      status: "refused",
      reason: "unavailable",
    });
    for (const status of [400, 401, 409, 413, 422, 429]) {
      expect(await submitResult(body, answer(status))).toEqual({
        status: "refused",
        reason: "refused",
      });
    }
    // The result may be stored behind these, so the secret must be kept.
    expect(await submitResult(body, answer(500))).toEqual({ status: "unknown" });
    expect(await submitResult(body, offline)).toEqual({ status: "unknown" });
    expect(await submitResult(body, answer(201, { nope: 1 }))).toEqual({ status: "unknown" });
  });
});

describe("correctResult and deleteResults", () => {
  it("report success plainly", async () => {
    expect(await correctResult("id", { secret: "s", ispSlug: "glo" }, answer(200))).toBe(true);
    expect(await correctResult("id", { secret: "s", ispSlug: "glo" }, answer(404))).toBe(false);
    expect(await deleteResults(["s"], answer(200, { deleted: 3 }))).toBe(3);
    expect(await deleteResults(["s"], answer(429))).toBeNull();
    expect(await deleteResults(["s"], offline)).toBeNull();
  });
});
