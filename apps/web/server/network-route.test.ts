import { describe, expect, it } from "vitest";
import type { IpProvider } from "./ip-provider";
import { noneProvider } from "./ip-provider";
import { handleNetworkRequest } from "./network-route";

const mtn: IpProvider = {
  id: "fake",
  lookup: (ip) =>
    Promise.resolve(
      ip === "102.88.85.10" ? { asn: 29465, countryCode: "NG", stateSlug: "lagos" } : null,
    ),
};

const request = (headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/network", { headers });

describe("handleNetworkRequest", () => {
  it("answers the detection as uncacheable JSON", async () => {
    const response = await handleNetworkRequest(
      request({ "x-real-ip": "102.88.85.10" }),
      mtn,
      "x-real-ip",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ isp: "mtn", state: "lagos" });
  });

  it("never echoes the IP", async () => {
    const response = await handleNetworkRequest(
      request({ "x-real-ip": "102.88.85.10" }),
      mtn,
      "x-real-ip",
    );
    expect(await response.text()).not.toContain("102.88");
  });

  it("detects nothing when no header is trusted, whatever the client sends", async () => {
    const response = await handleNetworkRequest(
      request({ "x-forwarded-for": "102.88.85.10", "x-real-ip": "102.88.85.10" }),
      mtn,
      undefined,
    );
    expect(await response.json()).toEqual({ isp: null, state: null });
  });

  it("detects nothing with the production provider", async () => {
    const response = await handleNetworkRequest(
      request({ "x-real-ip": "102.88.85.10" }),
      noneProvider,
      "x-real-ip",
    );
    expect(await response.json()).toEqual({ isp: null, state: null });
  });
});
