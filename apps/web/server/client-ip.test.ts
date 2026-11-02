import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";
import { normaliseIp } from "./ip-address";

const headers = (init: Record<string, string>) => new Headers(init);

describe("clientIp", () => {
  it("trusts no header by default, so a forged X-Forwarded-For is ignored", () => {
    const forged = headers({ "x-forwarded-for": "102.88.85.10", "x-real-ip": "102.88.85.10" });
    expect(clientIp(forged, undefined)).toBeNull();
    expect(clientIp(forged, "")).toBeNull();
    expect(clientIp(forged, "  ")).toBeNull();
  });

  it("reads a trusted single-value header, IPv4 and IPv6", () => {
    expect(clientIp(headers({ "x-real-ip": "102.88.85.10" }), "x-real-ip")).toBe("102.88.85.10");
    expect(clientIp(headers({ "x-real-ip": " 2C0F:F5C0:350::10 " }), "x-real-ip")).toBe(
      "2c0f:f5c0:350::10",
    );
  });

  it("matches the configured header name in any case", () => {
    expect(clientIp(headers({ "x-real-ip": "41.190.12.10" }), "X-Real-IP")).toBe("41.190.12.10");
  });

  it("rejects a single-value header that holds several values", () => {
    expect(clientIp(headers({ "x-real-ip": "1.2.3.4, 41.190.12.10" }), "x-real-ip")).toBeNull();
  });

  it("takes the rightmost X-Forwarded-For entry, the one the nearest proxy appended", () => {
    const chain = headers({ "x-forwarded-for": "6.6.6.6, 10.0.0.1 ,  105.113.60.10" });
    expect(clientIp(chain, "x-forwarded-for")).toBe("105.113.60.10");
  });

  it("reads nothing, rather than throwing, when the configured name isn't a header name", () => {
    expect(clientIp(headers({ "x-real-ip": "41.190.12.10" }), "x real ip")).toBeNull();
  });

  it("returns null when the trusted header is missing", () => {
    expect(clientIp(headers({}), "x-real-ip")).toBeNull();
  });

  it.each([
    "",
    "garbage",
    "1.2.3.4:80",
    "[2c0f:fd28::10]",
    "[2c0f:fd28::10]:443",
    "fe80::1%eth0",
    "999.1.1.1",
    "01.2.3.4",
  ])("rejects %j", (value) => {
    expect(clientIp(headers({ "x-real-ip": value }), "x-real-ip")).toBeNull();
  });

  it("turns IPv4-mapped IPv6 into IPv4", () => {
    expect(clientIp(headers({ "x-real-ip": "::ffff:102.88.85.10" }), "x-real-ip")).toBe(
      "102.88.85.10",
    );
  });
});

describe("normaliseIp", () => {
  it("unmaps every spelling of an IPv4-mapped address", () => {
    for (const spelling of [
      "::ffff:102.88.85.10",
      "::FFFF:6658:550a",
      "0:0:0:0:0:ffff:6658:550a",
    ]) {
      expect(normaliseIp(spelling)).toBe("102.88.85.10");
    }
  });

  it("leaves other IPv6 addresses alone", () => {
    expect(normaliseIp("::1")).toBe("::1");
    expect(normaliseIp("64:ff9b::102.88.85.10")).toBe("64:ff9b::102.88.85.10");
  });
});
