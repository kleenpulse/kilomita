import { describe, expect, it } from "vitest";
import { errorMessage } from "./messages";

describe("errorMessage", () => {
  it("explains a dropped connection", () => {
    expect(errorMessage({ code: "network-lost" })).toMatch(/connection dropped/);
  });

  it("tells a rate limit from a refusal", () => {
    expect(errorMessage({ code: "endpoint-error", status: 429 })).toMatch(/busy right now/);
    expect(errorMessage({ code: "endpoint-error", status: 403 })).toMatch(
      /refused requests from your network/,
    );
  });

  it("calls every 5xx a server problem", () => {
    for (const status of [500, 502, 503, 599]) {
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
