import { describe, expect, it } from "vitest";
import { errorMessage } from "./messages";

describe("errorMessage", () => {
  it("explains a dropped connection", () => {
    expect(errorMessage({ code: "network-lost" })).toMatch(/connection dropped/);
  });

  it("says when no test server is available", () => {
    // "Later": a server out of the day's budget is back only the next day.
    expect(errorMessage({ code: "no-server" })).toBe(
      "No test server is reachable right now. Try again later.",
    );
    expect(errorMessage({ code: "no-server", status: 503 })).toMatch(/No test server/);
  });

  it("tells a rate limit from a refusal", () => {
    expect(errorMessage({ code: "endpoint-error", status: 429 })).toMatch(/busy right now/);
    // True for a run ticket that ran out (our servers) and a blocked network (others).
    expect(errorMessage({ code: "endpoint-error", status: 403 })).toBe(
      "The test server refused the test. Reload the page and try again. If it keeps happening, try another network.",
    );
  });

  it("says a server that answers 503 is full, without promising minutes", () => {
    expect(errorMessage({ code: "endpoint-error", status: 503 })).toBe(
      "The test server is full right now. Please try again later.",
    );
  });

  it("calls every other 5xx a server problem", () => {
    for (const status of [500, 502, 504, 599]) {
      expect(errorMessage({ code: "endpoint-error", status })).toMatch(/server had a problem/);
    }
  });

  it("names any other status, and copes with none", () => {
    expect(errorMessage({ code: "endpoint-error", status: 404 })).toBe(
      "The test server didn't accept the test (error 404). Please try again later.",
    );
    expect(errorMessage({ code: "endpoint-error" })).toBe(
      "The test server didn't accept the test. Please try again later.",
    );
  });
});
