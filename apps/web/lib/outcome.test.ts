import type { EngineError, EngineResult } from "@kilomita/engine";
import { describe, expect, it } from "vitest";
import { outcomeReport, sendOutcome } from "./outcome";

const result = { serverId: "lagos-1" } as EngineResult;
const error = (code: EngineError["code"]) => ({
  status: "error" as const,
  error: { code } as EngineError,
});

describe("outcomeReport", () => {
  it.each([
    [{ status: "complete" as const, result }, false, { outcome: "complete", serverId: "lagos-1" }],
    [
      { status: "stopped" as const, reason: "user" as const },
      false,
      { outcome: "cancelled", serverId: null },
    ],
    [
      { status: "stopped" as const, reason: "hidden" as const },
      false,
      { outcome: "hidden", serverId: null },
    ],
    [
      { status: "stopped" as const, reason: "offline" as const },
      true,
      { outcome: "offline", serverId: null },
    ],
    [{ status: "crashed" as const, loaded: true }, false, { outcome: "crashed", serverId: null }],
    [{ status: "crashed" as const, loaded: false }, false, { outcome: "stale", serverId: null }],
    [error("cancelled"), false, { outcome: "cancelled", serverId: null }],
    [error("network-lost"), false, { outcome: "network-lost", serverId: null }],
    [error("network-lost"), true, { outcome: "offline", serverId: null }],
    [error("endpoint-error"), false, { outcome: "endpoint-error", serverId: null }],
    [error("no-server"), false, { outcome: "no-server", serverId: null }],
  ])("maps %j", (outcome, offline, expected) => {
    expect(outcomeReport(outcome, true, offline)).toEqual({ ...expected, lowData: true });
  });

  it("reports nothing when the page is unmounting", () => {
    expect(outcomeReport({ status: "stopped", reason: "unmount" }, false, false)).toBeNull();
  });
});

describe("sendOutcome", () => {
  it("posts exactly the three fields, with keepalive, and swallows failures", async () => {
    const calls: [string, RequestInit][] = [];
    const fetchFn = ((input: string, init: RequestInit) => {
      calls.push([input, init]);
      return Promise.reject(new Error("offline"));
    }) as unknown as typeof fetch;
    sendOutcome({ outcome: "complete", lowData: false, serverId: "lagos-1" }, fetchFn);
    await Promise.resolve();
    const [path, init] = calls[0] ?? ["", {}];
    expect(path).toBe("/api/outcomes");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({
      outcome: "complete",
      lowData: false,
      serverId: "lagos-1",
    });
  });
});
