import { SpeedTestResultSchema } from "@kilomita/shared";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "./index";

describe("ENGINE_VERSION", () => {
  it("is accepted by the result schema", () => {
    expect(SpeedTestResultSchema.shape.engineVersion.safeParse(ENGINE_VERSION).success).toBe(true);
  });
});
