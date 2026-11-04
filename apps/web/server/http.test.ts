import { afterEach, describe, expect, it, vi } from "vitest";
import { errorCode, guarded, log, logFailure } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

function capture(method: "error" | "warn" | "info") {
  const spy = vi.spyOn(console, method).mockImplementation(() => undefined);
  return () => spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

describe("log", () => {
  it("writes one JSON object per line with a time, level and event", () => {
    const lines = capture("warn");
    log("warn", "stores-memory", { note: "memory stores" });
    const [line] = lines();
    expect(line).toMatchObject({ level: "warn", event: "stores-memory", note: "memory stores" });
    expect(new Date(String(line?.t)).toISOString()).toBe(line?.t);
  });
});

describe("logFailure", () => {
  it("logs the code, never the message", () => {
    const lines = capture("error");
    const error = Object.assign(new Error("connect to db.example.neon.tech:5432"), {
      code: "ECONNREFUSED",
    });
    expect(logFailure("tokens", error)).toBe("ECONNREFUSED");
    expect(lines()).toEqual([expect.objectContaining({ event: "tokens", code: "ECONNREFUSED" })]);
    expect(JSON.stringify(lines())).not.toContain("neon.tech");
  });

  it("finds the SQLSTATE on the driver error that Drizzle wraps", () => {
    // Drizzle's query error has no code of its own; the Postgres error is its cause.
    const cause = Object.assign(new Error('relation "results" does not exist'), { code: "42P01" });
    expect(errorCode(new Error("Failed query: select ... from results", { cause }))).toBe("42P01");
  });

  it("says none when there is no code anywhere", () => {
    expect(errorCode(new Error("boom"))).toBe("none");
    expect(errorCode("not an error")).toBe("none");
    expect(errorCode(null)).toBe("none");
  });
});

describe("guarded", () => {
  it("answers a plain 500, logs the code and reports it", async () => {
    const lines = capture("error");
    const failures: string[] = [];
    const response = await guarded(
      "results-submit",
      () => Promise.reject(Object.assign(new Error("secret detail"), { code: "57P01" })),
      (event, code) => failures.push(`${event}:${code}`),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "failed" });
    expect(failures).toEqual(["results-submit:57P01"]);
    expect(JSON.stringify(lines())).not.toContain("secret detail");
  });

  it("passes a good answer through untouched", async () => {
    const ok = new Response("fine");
    expect(await guarded("tokens", () => Promise.resolve(ok))).toBe(ok);
  });
});
