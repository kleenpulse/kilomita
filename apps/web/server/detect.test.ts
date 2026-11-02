import { afterEach, describe, expect, it, vi } from "vitest";
import { detectNetwork } from "./detect";
import { type IpLookup, type IpProvider, noneProvider } from "./ip-provider";

/*
 * Real addresses inside prefixes their ASN announced on 2026-11-02, each checked with
 * https://stat.ripe.net/data/network-info/data.json?resource=<ip> (prefix and ASN in the comment).
 * The fake provider answers like a real one would; the test checks everything after the lookup.
 */
const NIGERIAN_IPS: readonly [ip: string, asn: number, isp: string][] = [
  ["102.88.85.10", 29465, "mtn"], // 102.88.85.0/24
  ["2c0f:f5c0:350::10", 29465, "mtn"], // 2c0f:f5c0:350::/48
  ["105.113.60.10", 36873, "airtel"], // 105.113.60.0/24
  ["2c0f:2280:1d0::10", 36873, "airtel"], // 2c0f:2280:1d0::/44
  ["197.211.62.10", 37148, "glo"], // 197.211.62.0/24
  ["2c0f:f9e0:1e00::10", 37148, "glo"], // 2c0f:f9e0:1e00::/40
  ["41.190.12.10", 37076, "9mobile"], // 41.190.12.0/24
  ["197.255.167.10", 37340, "spectranet"], // 197.255.166.0/23
  ["160.152.130.10", 37637, "smile"], // 160.152.128.0/19
  ["102.219.155.10", 329267, "fiberone"], // 102.219.155.0/24
  ["41.184.198.10", 29091, "ipnx"], // 41.184.198.0/24
  ["2c0f:fd28::10", 29091, "ipnx"], // 2c0f:fd28::/32
  ["102.215.204.10", 37682, "tizeti"], // 102.215.204.0/24
  ["2c0f:eac0::10", 37682, "tizeti"], // 2c0f:eac0::/32
  ["129.222.73.10", 14593, "starlink"], // 129.222.72.0/21
  ["2605:59c0:6500::10", 14593, "starlink"], // 2605:59c0:6500::/40
];

/** Cloudflare WARP, this machine's own egress: 2a09:bac5::/32, AS13335. */
const WARP_IP = "2a09:bac5::10";

function fakeProvider(table: Record<string, IpLookup>): IpProvider {
  return { id: "fake", lookup: (ip) => Promise.resolve(table[ip] ?? null) };
}

const nigerian = Object.fromEntries(
  NIGERIAN_IPS.map(([ip, asn]) => [ip, { asn, countryCode: "NG", stateSlug: "lagos" } as const]),
);

afterEach(() => {
  vi.useRealTimers();
});

describe("detectNetwork", () => {
  it.each(NIGERIAN_IPS)("detects %s (AS%d) as %s", async (ip, _asn, isp) => {
    expect(await detectNetwork(ip, fakeProvider(nigerian))).toEqual({ isp, state: "lagos" });
  });

  it("calls an unmapped ASN Other", async () => {
    const provider = fakeProvider({
      [WARP_IP]: { asn: 13335, countryCode: "NG", stateSlug: null },
    });
    expect(await detectNetwork(WARP_IP, provider)).toEqual({ isp: "other", state: null });
  });

  it("uses the state only for Nigerian addresses", async () => {
    const provider = fakeProvider({
      "129.222.73.10": { asn: 14593, countryCode: "GB", stateSlug: "lagos" },
    });
    expect(await detectNetwork("129.222.73.10", provider)).toEqual({
      isp: "starlink",
      state: null,
    });
  });

  it("knows nothing without an ASN", async () => {
    const provider = fakeProvider({
      "1.2.3.4": { asn: null, countryCode: "NG", stateSlug: "kano" },
    });
    expect(await detectNetwork("1.2.3.4", provider)).toEqual({ isp: null, state: "kano" });
  });

  it("detects nothing without an IP, or with no provider", async () => {
    expect(await detectNetwork(null, fakeProvider(nigerian))).toEqual({ isp: null, state: null });
    expect(await detectNetwork("102.88.85.10", noneProvider)).toEqual({ isp: null, state: null });
  });

  it("treats a provider error as nothing detected", async () => {
    const rejecting: IpProvider = { id: "down", lookup: () => Promise.reject(new Error("503")) };
    const throwing: IpProvider = {
      id: "broken",
      lookup: () => {
        throw new Error("bug");
      },
    };
    expect(await detectNetwork("102.88.85.10", rejecting)).toEqual({ isp: null, state: null });
    expect(await detectNetwork("102.88.85.10", throwing)).toEqual({ isp: null, state: null });
  });

  it("gives up after the timeout and aborts the lookup", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const hanging: IpProvider = {
      id: "slow",
      lookup: (_ip, abort) => {
        signal = abort;
        return new Promise(() => undefined);
      },
    };
    const pending = detectNetwork("102.88.85.10", hanging, 1500);
    await vi.advanceTimersByTimeAsync(1499);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ isp: null, state: null });
    expect(signal?.aborted).toBe(true);
  });
});
