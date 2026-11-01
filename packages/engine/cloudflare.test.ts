import { beforeEach, describe, expect, it } from "vitest";
import { cloudflareEndpoint, parseCloudflareServerTime } from "./cloudflare";
import { blockRealNetwork } from "./simulated-network";

beforeEach(() => {
  blockRealNetwork();
});

const timing = (value: string) => new Headers({ "server-timing": value });

describe("cloudflareEndpoint", () => {
  it("builds the speed.cloudflare.com URLs", () => {
    expect(cloudflareEndpoint.latencyUrl()).toBe("https://speed.cloudflare.com/__down?bytes=0");
    expect(cloudflareEndpoint.downloadUrl(25_000_000)).toBe(
      "https://speed.cloudflare.com/__down?bytes=25000000",
    );
    expect(cloudflareEndpoint.uploadUrl()).toBe("https://speed.cloudflare.com/__up");
  });

  it("stays below the observed 100,000,000-byte limit", () => {
    expect(cloudflareEndpoint.maxDownloadBytes).toBe(99_999_999);
  });
});

describe("parseCloudflareServerTime", () => {
  it("prefers cfRequestDuration", () => {
    expect(
      parseCloudflareServerTime(timing("cfRequestDuration;dur=12.5, cfSpeedWorker;dur=30")),
    ).toBe(12.5);
  });

  it("otherwise sums the cfSpeed entries, as Node joins repeated headers", () => {
    const joined = 'cfSpeedEdge;dur=9, cfSpeedWorker;dur=28, cfL4;desc="?proto=TCP&rtt=0"';
    expect(parseCloudflareServerTime(timing(joined))).toBe(37);
  });

  it("ignores values at or below 0.01 ms, and missing headers", () => {
    expect(parseCloudflareServerTime(timing("cfSpeedWorker;dur=0.01"))).toBeUndefined();
    expect(parseCloudflareServerTime(timing("cfL4;desc=x"))).toBeUndefined();
    expect(parseCloudflareServerTime(new Headers())).toBeUndefined();
  });
});
