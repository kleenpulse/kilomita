import { describe, expect, it } from "vitest";
import { parseStored, readLowData, resolveLowData, writeLowData } from "./low-data";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

const throwing = () => {
  throw new DOMException("blocked", "SecurityError");
};

describe("parseStored", () => {
  it("reads only the two values it writes", () => {
    expect(parseStored("on")).toBe(true);
    expect(parseStored("off")).toBe(false);
    for (const garbage of [null, "", "true", "1", "ON"]) expect(parseStored(garbage)).toBeNull();
  });
});

describe("resolveLowData", () => {
  it("follows Data Saver when the user hasn't chosen", () => {
    expect(resolveLowData(null, true)).toBe(true);
    expect(resolveLowData(null, false)).toBe(false);
    expect(resolveLowData("garbage", true)).toBe(true);
  });

  it("lets the user's choice beat Data Saver", () => {
    expect(resolveLowData("off", true)).toBe(false);
    expect(resolveLowData("on", false)).toBe(true);
  });
});

describe("readLowData and writeLowData", () => {
  it("round-trips a choice through storage", () => {
    const storage = memoryStorage();
    writeLowData(true, () => storage);
    expect(
      readLowData(
        () => storage,
        () => false,
      ),
    ).toBe(true);
    writeLowData(false, () => storage);
    expect(
      readLowData(
        () => storage,
        () => true,
      ),
    ).toBe(false);
  });

  it("falls back to the default when storage throws on read", () => {
    expect(readLowData(throwing, () => true)).toBe(true);
    expect(readLowData(throwing, () => false)).toBe(false);
  });

  it("keeps a choice for this page when storage refuses to save it", () => {
    writeLowData(true, throwing);
    expect(readLowData(throwing, () => false)).toBe(true);
    // A later successful save takes over again.
    const storage = memoryStorage();
    writeLowData(false, () => storage);
    expect(
      readLowData(
        () => storage,
        () => true,
      ),
    ).toBe(false);
  });
});
