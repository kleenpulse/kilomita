import { describe, expect, it } from "vitest";
import { deviceClass } from "./device-class";

describe("deviceClass", () => {
  it("trusts the browser's own mobile flag", () => {
    expect(deviceClass({ mobile: true, coarsePointer: false, shortSide: 1080 })).toBe("mobile");
  });

  it("tells phones, tablets and computers apart by pointer and screen size", () => {
    expect(deviceClass({ coarsePointer: true, shortSide: 412 })).toBe("mobile");
    expect(deviceClass({ coarsePointer: true, shortSide: 600 })).toBe("tablet");
    expect(deviceClass({ mobile: false, coarsePointer: true, shortSide: 800 })).toBe("tablet");
    expect(deviceClass({ coarsePointer: false, shortSide: 1080 })).toBe("desktop");
  });
});
