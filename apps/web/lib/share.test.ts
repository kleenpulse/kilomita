import type { EngineResult } from "@kilomita/engine";
import { describe, expect, it } from "vitest";
import { type ShareProgress, correction, reusable, sharedResult, shareStep } from "./share";
import type { HeldToken } from "./sharing-api";

const NOW = 1_000_000;
const token: HeldToken = { value: "v1.a.b", expiresAt: NOW + 30 * 60_000, lowData: true };
const notSent: ShareProgress = { status: "not-sent" };
const base = {
  consent: "granted" as const,
  progress: notSent,
  token,
  isp: "mtn" as const,
  expired: false,
};

describe("shareStep", () => {
  it("sends once consent is granted, a network is chosen and a token is in hand", () => {
    expect(shareStep(base)).toEqual({ kind: "send" });
  });

  it("sends nothing unless the user agreed, and then shows the consent status", () => {
    expect(shareStep({ ...base, consent: "unasked" })).toEqual({ kind: "show", status: null });
    expect(shareStep({ ...base, consent: "declined" })).toEqual({ kind: "show", status: null });
  });

  it("waits for a network: nothing is sent while revoking before one is picked", () => {
    expect(shareStep({ ...base, isp: null })).toEqual({ kind: "show", status: "waiting-isp" });
    expect(shareStep({ ...base, isp: null, consent: "declined" })).toEqual({
      kind: "show",
      status: null,
    });
  });

  it("shares the result on screen when consent comes after it", () => {
    expect(shareStep({ ...base, consent: "unasked" }).kind).toBe("show");
    expect(shareStep({ ...base, consent: "granted" }).kind).toBe("send");
  });

  it("can't share without a token, or once it ran out", () => {
    expect(shareStep({ ...base, token: null })).toEqual({ kind: "show", status: "unavailable" });
    expect(shareStep({ ...base, expired: true })).toEqual({ kind: "show", status: "too-old" });
  });

  it("never sends a result twice, whatever happens to consent afterwards", () => {
    const shared: ShareProgress = {
      status: "shared",
      id: "id",
      secret: "s",
      sent: { isp: "mtn", state: null, type: "4g" },
    };
    expect(shareStep({ ...base, progress: shared })).toEqual({ kind: "show", status: "shared" });
    expect(shareStep({ ...base, progress: shared, consent: "declined" })).toEqual({
      kind: "show",
      status: "shared",
    });
    expect(shareStep({ ...base, progress: { status: "failed" } })).toEqual({
      kind: "show",
      status: "failed",
    });
  });
});

describe("correction", () => {
  const sent = { isp: "mtn", state: "lagos", type: "4g" } as const;

  it("sends only what changed", () => {
    expect(correction(sent, sent)).toBeNull();
    expect(correction(sent, { ...sent, isp: "glo" })).toEqual({ ispSlug: "glo" });
    expect(correction(sent, { ...sent, state: null, type: "3g" })).toEqual({
      stateSlug: null,
      networkType: "3g",
    });
  });

  it("doesn't clear the network of a shared result", () => {
    expect(correction(sent, { ...sent, isp: null })).toBeNull();
  });
});

describe("reusable", () => {
  it("reuses only a token never sent, with 5 minutes left, for the same profile", () => {
    expect(reusable(token, false, true, NOW)).toBe(true);
    expect(reusable(token, true, true, NOW)).toBe(false);
    expect(reusable(token, false, false, NOW)).toBe(false);
    expect(reusable(token, false, true, token.expiresAt - 5 * 60_000)).toBe(true);
    expect(reusable(token, false, true, token.expiresAt - 5 * 60_000 + 1)).toBe(false);
    expect(reusable(null, false, true, NOW)).toBe(false);
  });
});

describe("sharedResult", () => {
  it("keeps the measurement and the network details, and drops the engine's extras", () => {
    const engine: EngineResult = {
      downloadMbps: 10,
      uploadMbps: 2,
      latency: { idleMedianMs: 40, idleP95Ms: 60, jitterMs: 3, requestLossPct: 0 },
      loadedLatency: { downloadMs: 70, uploadMs: 50, grade: "B" },
      loadedP95Ms: { download: 90, upload: 70 },
      addedLatencyMs: 30,
      bytesUsed: 5_000_000,
      durationMs: 9_000,
      lowDataMode: true,
      engineVersion: "0.3.0",
      serverId: "cloudflare",
      measuredAt: "2026-11-02T12:00:00.000Z",
      stoppedBy: { download: "stable", upload: "time" },
    };
    const result = sharedResult(engine, { isp: "mtn", state: null, type: "4g" }, "mobile");
    expect(result).toEqual({
      downloadMbps: 10,
      uploadMbps: 2,
      latency: engine.latency,
      loadedLatency: engine.loadedLatency,
      bytesUsed: 5_000_000,
      durationMs: 9_000,
      lowDataMode: true,
      engineVersion: "0.3.0",
      serverId: "cloudflare",
      measuredAt: "2026-11-02T12:00:00.000Z",
      ispSlug: "mtn",
      networkType: "4g",
      deviceClass: "mobile",
    });
  });
});
