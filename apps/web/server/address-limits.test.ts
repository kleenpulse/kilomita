import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADDRESS_LIMITS,
  WIDE_FACTOR,
  addressKeys,
  windowOf,
  withinAddressLimit,
  withinRunLimits,
} from "./address-limits";
import { hashIpPrefix } from "./ip-hash";
import { type Kv, memoryKv } from "./kv";

afterEach(() => {
  vi.restoreAllMocks();
});

const SALT = new Uint8Array(32).fill(7);
const T0 = Date.UTC(2026, 10, 4, 10, 15);

// One salt store, as in the app (one per process): a new store per call would mean a new salt.
const fixedSalt = { saltForToday: () => Promise.resolve(SALT) };

function context(ip: string | null, now = T0, kv: Kv = memoryKv(() => now)) {
  return { kv, salt: fixedSalt, ip, now };
}

async function spend(ctx: ReturnType<typeof context>, times: number, max: number) {
  let last = true;
  for (let i = 0; i < times; i++) last = await withinAddressLimit(ctx, "probe", max, "hour");
  return last;
}

describe("addressKeys", () => {
  it("keys IPv4 on the full address, IPv4-mapped IPv6 alike", () => {
    const keys = addressKeys("102.88.34.10", SALT);
    expect(keys).toHaveLength(1);
    expect(keys[0]?.tier).toBe("addr");
    expect(addressKeys("::ffff:102.88.34.10", SALT)).toEqual(keys);
    expect(addressKeys("102.88.34.11", SALT)[0]?.hash).not.toBe(keys[0]?.hash);
  });

  it("keys IPv6 on the /64 and the /48", () => {
    const [a64, a48] = addressKeys("2c0f:f5c0:1:2:aaaa::1", SALT);
    const [b64, b48] = addressKeys("2c0f:f5c0:1:3::1", SALT);
    const [c64] = addressKeys("2c0f:f5c0:1:2:ffff::9", SALT);
    expect(a64?.tier).toBe("addr");
    expect(a48?.tier).toBe("wide");
    expect(a64?.hash).toBe(c64?.hash); // same /64
    expect(a64?.hash).not.toBe(b64?.hash); // another /64
    expect(a48?.hash).toBe(b48?.hash); // same /48
  });

  it("never equals the stored prefix hash, and changes with the salt", () => {
    const [key] = addressKeys("102.88.34.10", SALT);
    expect(hashIpPrefix("102.88.34.10", SALT)).not.toContain(key?.hash ?? "-");
    expect(addressKeys("102.88.34.10", new Uint8Array(32).fill(8))[0]?.hash).not.toBe(key?.hash);
  });
});

describe("windowOf", () => {
  it("ends hours and minutes on their boundary and days at UTC midnight", () => {
    expect(windowOf("minute", T0).end).toBe(Date.UTC(2026, 10, 4, 10, 16));
    expect(windowOf("hour", T0).end).toBe(Date.UTC(2026, 10, 4, 11));
    expect(windowOf("day", T0)).toEqual({ index: "2026-11-04", end: Date.UTC(2026, 10, 5) });
  });
});

describe("withinAddressLimit", () => {
  it("allows exactly max calls from one IPv4 address in a window", async () => {
    const ctx = context("102.88.34.10");
    expect(await spend(ctx, 3, 3)).toBe(true);
    expect(await withinAddressLimit(ctx, "probe", 3, "hour")).toBe(false);
    // Another address is untouched.
    expect(await withinAddressLimit({ ...ctx, ip: "102.88.34.11" }, "probe", 3, "hour")).toBe(true);
  });

  it("starts again in the next window", async () => {
    const kv = memoryKv(() => T0 + 3_600_000);
    const first = context("102.88.34.10", T0, kv);
    await spend(first, 4, 3);
    expect(await withinAddressLimit({ ...first, now: T0 + 3_600_000 }, "probe", 3, "hour")).toBe(
      true,
    );
  });

  it("does nothing without an address, and creates no key", async () => {
    const kv = memoryKv(() => T0);
    const count = vi.spyOn(kv, "countInWindow");
    expect(await spend(context(null, T0, kv), 100, 1)).toBe(true);
    expect(await withinAddressLimit(null, "probe", 1, "hour")).toBe(true);
    expect(count).not.toHaveBeenCalled();
  });

  it("caps a whole IPv6 /48 at WIDE_FACTOR times the per-/64 limit", async () => {
    const kv = memoryKv(() => T0);
    const max = 2;
    let allowed = 0;
    // A home with a /56 rotating through its /64s.
    for (let subnet = 0; subnet < 40; subnet++) {
      const ip = `2c0f:f5c0:1:${subnet.toString(16)}::1`;
      for (let i = 0; i < max; i++) {
        if (await withinAddressLimit(context(ip, T0, kv), "probe", max, "hour")) allowed++;
      }
    }
    expect(allowed).toBe(max * WIDE_FACTOR);
  });

  it("fails open, logged by code, when Redis fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken: Kv = {
      ...memoryKv(),
      countInWindow: () =>
        Promise.reject(Object.assign(new Error("redis down"), { code: "ETIMEDOUT" })),
    };
    expect(await withinAddressLimit(context("102.88.34.10", T0, broken), "probe", 0, "hour")).toBe(
      true,
    );
    expect(warn.mock.calls.map(([line]) => JSON.parse(String(line)) as unknown)).toEqual([
      expect.objectContaining({ event: "limit-skipped", code: "ETIMEDOUT" }),
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("redis down");
  });

  it("fails open when the salt can't be read either", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ctx = {
      ...context("102.88.34.10"),
      salt: { saltForToday: () => Promise.reject(new Error("no salt")) },
    };
    expect(await withinAddressLimit(ctx, "probe", 0, "hour")).toBe(true);
  });
});

describe("withinRunLimits", () => {
  it("refuses past the hourly limit, and past the daily one across hours", async () => {
    const kv = memoryKv(() => T0);
    const ip = "102.88.34.10";
    let allowed = 0;
    for (let i = 0; i < ADDRESS_LIMITS.runsPerHour + 5; i++) {
      if (await withinRunLimits(context(ip, T0, kv), "servers")) allowed++;
    }
    expect(allowed).toBe(ADDRESS_LIMITS.runsPerHour);

    let daily = 0;
    for (let hour = 0; hour < 12; hour++) {
      const now = Date.UTC(2026, 10, 5, hour);
      for (let i = 0; i < ADDRESS_LIMITS.runsPerHour; i++) {
        if (await withinRunLimits(context(ip, now, kv), "servers")) daily++;
      }
    }
    expect(daily).toBe(ADDRESS_LIMITS.runsPerDay);
  });
});
