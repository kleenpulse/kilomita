import { describe, expect, it } from "vitest";
import { readLicense, satisfies, storeEntryToName } from "./check-licenses";

describe("satisfies", () => {
  it.each([
    "MIT",
    "Apache-2.0 AND LGPL-3.0-or-later",
    "(MIT OR GPL-2.0-only)",
    "GPL-2.0-only OR MIT",
    "(BSD-3-Clause AND (MIT OR CC-BY-4.0))",
    "GPL-3.0+",
    "Apache-2.0 WITH LLVM-exception",
  ])("accepts %s", (expression) => {
    expect(satisfies(expression)).toBe(true);
  });

  it.each([
    "UNLICENSED",
    "CC-BY-4.0",
    "SSPL-1.0",
    "MIT AND BUSL-1.1",
    "GPL-2.0-only",
    "(MIT",
    "MIT OR",
    "SEE LICENSE IN LICENSE.md",
  ])("rejects %s", (expression) => {
    expect(satisfies(expression)).toBe(false);
  });
});

describe("readLicense", () => {
  it("reads the modern, object and legacy array forms", () => {
    expect(readLicense({ license: "MIT" })).toBe("MIT");
    expect(readLicense({ license: { type: "ISC" } })).toBe("ISC");
    expect(readLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] })).toBe(
      "MIT OR Apache-2.0",
    );
    expect(readLicense({})).toBeUndefined();
  });
});

describe("storeEntryToName", () => {
  it("decodes Bun isolated store entries", () => {
    expect(storeEntryToName("zod@4.6.7")).toBe("zod");
    expect(storeEntryToName("@types+react@19.3.0")).toBe("@types/react");
    expect(storeEntryToName("sharp@0.35.5+664724dec0ad8d9e")).toBe("sharp");
    expect(storeEntryToName("node_modules")).toBeUndefined();
  });
});
