import { describe, expect, it } from "vitest";
import { CONNECTION_HINT, connectionKind } from "./connection-hint";
import { networkNote } from "./network-note";

describe("networkNote", () => {
  it("says what was detected and invites a correction", () => {
    expect(networkNote({ isp: "mtn", state: "lagos" })).toBe(
      "We think you're on MTN in Lagos. Not right? Correct it below.",
    );
    expect(networkNote({ isp: "fiberone", state: null })).toBe(
      "We think you're on FiberOne. Not right? Correct it below.",
    );
    expect(networkNote({ isp: null, state: "fct" })).toBe(
      "We think you're in Federal Capital Territory. Choose your network below.",
    );
  });

  it("asks for a choice when nothing useful was detected", () => {
    expect(networkNote({ isp: "other", state: "lagos" })).toBe(
      "We couldn't match your network. Choose it below.",
    );
    expect(networkNote({ isp: null, state: null })).toBe(
      "Choose your network and state so this result is labelled correctly.",
    );
    expect(networkNote(null)).toBe(networkNote({ isp: null, state: null }));
  });

  it("says it is still checking", () => {
    expect(networkNote("pending")).toBe("Checking your network…");
  });
});

describe("connectionKind", () => {
  it("hints only for types that say something", () => {
    expect(connectionKind("cellular")).toBe("cellular");
    expect(connectionKind("wifi")).toBe("wifi");
    expect(connectionKind("ethernet")).toBe("ethernet");
    for (const silent of ["bluetooth", "wimax", "none", "other", "unknown", undefined, "4g"]) {
      expect(connectionKind(silent)).toBeNull();
    }
  });

  it("never names a mobile generation", () => {
    for (const hint of Object.values(CONNECTION_HINT)) expect(hint).not.toMatch(/\b[2-5]G\b/);
  });
});
