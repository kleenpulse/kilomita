import { describe, expect, it } from "vitest";
import { mayShare, readConsent, writeConsent } from "./consent";

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

describe("readConsent", () => {
  it("is unasked until the user chooses", () => {
    expect(readConsent(() => memoryStorage())).toBe("unasked");
  });

  it("reads only the two values it writes", () => {
    expect(readConsent(() => memoryStorage("granted"))).toBe("granted");
    expect(readConsent(() => memoryStorage("declined"))).toBe("declined");
    for (const garbage of ["", "yes", "true", "GRANTED", "on"]) {
      expect(readConsent(() => memoryStorage(garbage))).toBe("unasked");
    }
  });

  it("is unasked when storage throws", () => {
    expect(readConsent(throwing)).toBe("unasked");
  });
});

describe("writeConsent", () => {
  it("round-trips both choices", () => {
    const storage = memoryStorage();
    writeConsent("granted", () => storage);
    expect(readConsent(() => storage)).toBe("granted");
    writeConsent("declined", () => storage);
    expect(readConsent(() => storage)).toBe("declined");
  });

  it("keeps a refused choice for this page, until a save works again", () => {
    writeConsent("granted", throwing);
    expect(readConsent(throwing)).toBe("granted");
    const storage = memoryStorage();
    writeConsent("declined", () => storage);
    expect(readConsent(() => storage)).toBe("declined");
  });
});

describe("mayShare", () => {
  it("lets a result leave the device only with consent", () => {
    expect(mayShare("granted")).toBe(true);
    expect(mayShare("declined")).toBe(false);
    expect(mayShare("unasked")).toBe(false);
  });
});
