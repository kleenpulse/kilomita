import { describe, expect, it } from "vitest";
import { knownServerIds, parseTestServers } from "./test-servers";

describe("parseTestServers", () => {
  it("reads id=origin pairs in order", () => {
    const config = parseTestServers({
      KILOMITA_TEST_SERVERS:
        "lagos-1=https://lagos-1.kilomita.ng, abuja=https://abuja.kilomita.ng:8443",
      NODE_ENV: "production",
    });
    expect(config.servers).toEqual([
      { id: "lagos-1", origin: "https://lagos-1.kilomita.ng" },
      { id: "abuja", origin: "https://abuja.kilomita.ng:8443" },
    ]);
    expect(config.warnings).toEqual([]);
  });

  it.each([
    "lagos=http://lagos.kilomita.ng",
    "lagos=https://lagos.kilomita.ng/",
    "lagos=https://lagos.kilomita.ng/path",
    "Lagos=https://lagos.kilomita.ng",
    "cloudflare=https://speed.example.ng",
    "=https://lagos.kilomita.ng",
    "lagos",
    "lagos=",
    `${"x".repeat(33)}=https://lagos.kilomita.ng`,
  ])("drops %j and says which entry, never its value", (entry) => {
    const config = parseTestServers({ KILOMITA_TEST_SERVERS: entry });
    expect(config.servers).toEqual([]);
    expect(config.warnings).toEqual([
      "KILOMITA_TEST_SERVERS entry 1 is not id=origin; it is ignored.",
    ]);
  });

  it("drops a repeated id", () => {
    const config = parseTestServers({
      KILOMITA_TEST_SERVERS: "a=https://a.kilomita.ng,a=https://b.kilomita.ng",
    });
    expect(config.servers).toEqual([{ id: "a", origin: "https://a.kilomita.ng" }]);
    expect(config.warnings).toHaveLength(1);
  });

  it("allows this machine over plain HTTP, with a warning in production", () => {
    const entry = "local=http://localhost:3945";
    expect(parseTestServers({ KILOMITA_TEST_SERVERS: entry, NODE_ENV: "development" })).toEqual({
      servers: [{ id: "local", origin: "http://localhost:3945" }],
      fallback: true,
      warnings: [],
    });
    const production = parseTestServers({ KILOMITA_TEST_SERVERS: entry, NODE_ENV: "production" });
    expect(production.servers).toHaveLength(1);
    expect(production.warnings).toEqual(["KILOMITA_TEST_SERVERS entry 1 points at this machine."]);
  });

  it("keeps the Cloudflare fallback off in production unless it is switched on", () => {
    expect(parseTestServers({ NODE_ENV: "production" }).fallback).toBe(false);
    expect(parseTestServers({ NODE_ENV: "test" }).fallback).toBe(false);
    expect(parseTestServers({ NODE_ENV: "development" }).fallback).toBe(true);
    expect(
      parseTestServers({ NODE_ENV: "production", KILOMITA_CLOUDFLARE_FALLBACK: "on" }).fallback,
    ).toBe(true);
    expect(
      parseTestServers({ NODE_ENV: "development", KILOMITA_CLOUDFLARE_FALLBACK: "off" }).fallback,
    ).toBe(false);
    expect(
      parseTestServers({ NODE_ENV: "production", KILOMITA_CLOUDFLARE_FALLBACK: "yes" }).fallback,
    ).toBe(false);
  });
});

describe("knownServerIds", () => {
  it("lists our servers, and Cloudflare only while the fallback is on", () => {
    const servers = [{ id: "lagos-1", origin: "https://lagos-1.kilomita.ng" }];
    expect([...knownServerIds({ servers, fallback: false, warnings: [] })]).toEqual(["lagos-1"]);
    expect([...knownServerIds({ servers, fallback: true, warnings: [] })]).toEqual([
      "lagos-1",
      "cloudflare",
    ]);
  });
});
