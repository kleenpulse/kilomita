import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config.ts";

const SECRET = Buffer.alloc(32, 1).toString("base64");
const valid = {
  KILOMITA_SERVER_ORIGINS: "https://kilomita.ng",
  KILOMITA_SERVER_TICKET_SECRET: SECRET,
};

describe("parseConfig", () => {
  it("reads a minimal config with defaults", () => {
    const config = parseConfig(valid);
    expect(config.port).toBe(3940);
    expect(config.host).toBe("127.0.0.1");
    expect([...config.origins]).toEqual(["https://kilomita.ng"]);
    expect(config.protocol).toBe("h1");
    expect(config.budgetBytes).toBeNull();
    expect(config.stateDir).toBeNull();
  });

  it("reads every setting", () => {
    const config = parseConfig({
      ...valid,
      KILOMITA_SERVER_ORIGINS: "https://kilomita.ng, http://localhost:3000",
      PORT: "8080",
      HOST: "0.0.0.0",
      KILOMITA_SERVER_PROTOCOL: "h2c",
      KILOMITA_EGRESS_BUDGET_GB: "900",
      KILOMITA_STATE_DIR: "/data",
    });
    expect([...config.origins]).toEqual(["https://kilomita.ng", "http://localhost:3000"]);
    expect(config).toMatchObject({
      port: 8080,
      host: "0.0.0.0",
      protocol: "h2c",
      budgetBytes: 900e9,
      stateDir: "/data",
    });
  });

  it.each([
    ["*"],
    ["https://kilomita.ng/"],
    ["https://kilomita.ng/path"],
    ["kilomita.ng"],
    ["ftp://kilomita.ng"],
    ["https://KILOMITA.ng"],
    [""],
  ])("refuses the origin list %j", (origins) => {
    expect(() => parseConfig({ ...valid, KILOMITA_SERVER_ORIGINS: origins })).toThrow(ConfigError);
  });

  it("refuses a bad secret without echoing it", () => {
    const bad = Buffer.alloc(16, 9).toString("base64");
    let message = "";
    try {
      parseConfig({ ...valid, KILOMITA_SERVER_TICKET_SECRET: bad });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/KILOMITA_SERVER_TICKET_SECRET/);
    expect(message).not.toContain(bad);
    expect(() => parseConfig({ ...valid, KILOMITA_SERVER_TICKET_SECRET: undefined })).toThrow(
      ConfigError,
    );
  });

  it.each([
    [{ KILOMITA_SERVER_PROTOCOL: "h2" }],
    [{ PORT: "70000" }],
    [{ PORT: "12.5" }],
    [{ KILOMITA_EGRESS_BUDGET_GB: "0" }],
    [{ KILOMITA_EGRESS_BUDGET_GB: "lots" }],
  ])("refuses %j", (extra) => {
    expect(() => parseConfig({ ...valid, ...extra })).toThrow(ConfigError);
  });
});
