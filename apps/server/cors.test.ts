import { describe, expect, it } from "vitest";
import { corsHeaders } from "./cors.ts";

const allowed = new Set(["https://kilomita.ng"]);

describe("corsHeaders", () => {
  it("grants exactly the allowed origin, with Server-Timing exposed", () => {
    expect(corsHeaders("https://kilomita.ng", allowed)).toEqual({
      vary: "Origin",
      "access-control-allow-origin": "https://kilomita.ng",
      "access-control-expose-headers": "Server-Timing",
      "timing-allow-origin": "https://kilomita.ng",
    });
  });

  it.each([
    [undefined],
    ["null"],
    ["https://kilomita.ng.evil.example"],
    ["https://evil.kilomita.ng"],
    ["https://kilomita.n"],
    ["http://kilomita.ng"],
    ["https://kilomita.ng:8443"],
    ["https://KILOMITA.ng"],
    ["https://kilomita.ng/"],
  ])("grants nothing to %j", (origin) => {
    expect(corsHeaders(origin, allowed)).toEqual({ vary: "Origin" });
  });
});
