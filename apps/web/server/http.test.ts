import { afterEach, describe, expect, it, vi } from "vitest";
import { logFailure } from "./http";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logFailure", () => {
  function logged(error: unknown): unknown[][] {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logFailure("Sharing request", error);
    const calls = [...log.mock.calls];
    log.mockRestore();
    return calls;
  }

  it("logs the code, never the message", () => {
    const error = Object.assign(new Error("connect to db.example.neon.tech:5432"), {
      code: "ECONNREFUSED",
    });
    expect(logged(error)).toEqual([["Sharing request failed (ECONNREFUSED)"]]);
  });

  it("finds the SQLSTATE on the driver error that Drizzle wraps", () => {
    // Drizzle's query error has no code of its own; the Postgres error is its cause.
    const cause = Object.assign(new Error('relation "results" does not exist'), { code: "42P01" });
    const wrapped = new Error("Failed query: select ... from results", { cause });
    expect(logged(wrapped)).toEqual([["Sharing request failed (42P01)"]]);
  });

  it("says so when there is no code anywhere", () => {
    expect(logged(new Error("boom"))).toEqual([["Sharing request failed (no code)"]]);
    expect(logged("not an error")).toEqual([["Sharing request failed (no code)"]]);
  });
});
