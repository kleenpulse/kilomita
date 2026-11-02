import { describe, expect, it } from "vitest";
import { hashIpPrefix, ipPrefix, kvSaltStore, memorySaltStore, nextUtcMidnight } from "./ip-hash";
import { type Kv, memoryKv } from "./kv";

const salt = (byte: number) => new Uint8Array(32).fill(byte);
const DAY = 86_400_000;
const NOON = Date.UTC(2026, 10, 2, 12);

describe("ipPrefix", () => {
  it("keeps the /24 of IPv4 and the /48 of IPv6", () => {
    expect(ipPrefix("102.88.85.10")).toBe("102.88.85.0/24");
    expect(ipPrefix("2c0f:f5c0:350:1:2::10")).toBe("2c0f:f5c0:0350::/48");
  });

  it("treats IPv4-mapped IPv6 as IPv4, not as ::/48", () => {
    expect(ipPrefix("::ffff:102.88.85.10")).toBe("102.88.85.0/24");
    expect(ipPrefix("::ffff:6658:550a")).toBe("102.88.85.0/24");
  });

  it("reads every spelling of an IPv6 address the same", () => {
    expect(ipPrefix("2C0F:FD28::10")).toBe(ipPrefix("2c0f:fd28:0000:0000:0000:0000:0000:0010"));
    expect(ipPrefix("2c0f:fd28::")).toBe("2c0f:fd28:0000::/48");
  });

  it("rejects anything that isn't an IP", () => {
    expect(() => ipPrefix("1.2.3")).toThrow(TypeError);
    expect(() => ipPrefix("fe80::1%eth0")).toThrow(TypeError);
  });
});

describe("hashIpPrefix", () => {
  it("hashes two IPs in one /24 the same, and two /24s in one /16 differently", () => {
    expect(hashIpPrefix("102.88.85.10", salt(1))).toBe(hashIpPrefix("102.88.85.250", salt(1)));
    expect(hashIpPrefix("102.88.85.10", salt(1))).not.toBe(hashIpPrefix("102.88.86.10", salt(1)));
  });

  it("does the same for IPv6 /48s", () => {
    expect(hashIpPrefix("2c0f:f5c0:350:1::1", salt(1))).toBe(
      hashIpPrefix("2c0f:f5c0:350:ffff::2", salt(1)),
    );
    expect(hashIpPrefix("2c0f:f5c0:350::1", salt(1))).not.toBe(
      hashIpPrefix("2c0f:f5c0:351::1", salt(1)),
    );
  });

  it("never puts the address in the output", () => {
    const hash = hashIpPrefix("102.88.85.10", salt(1));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("102");
  });

  it("depends on the salt", () => {
    expect(hashIpPrefix("102.88.85.10", salt(1))).not.toBe(hashIpPrefix("102.88.85.10", salt(2)));
  });

  it("refuses a salt that isn't 32 bytes", () => {
    expect(() => hashIpPrefix("102.88.85.10", new Uint8Array(16))).toThrow(RangeError);
    expect(() => hashIpPrefix("102.88.85.10", new Uint8Array(33))).toThrow(RangeError);
  });
});

describe("memorySaltStore", () => {
  it("keeps one salt for the whole UTC day", async () => {
    let now = Date.UTC(2026, 10, 2, 0, 0, 0);
    const store = memorySaltStore(() => now);
    const first = await store.saltForToday();
    now += DAY - 1;
    expect(await store.saltForToday()).toBe(first);
    expect(first.byteLength).toBe(32);
  });

  it("makes a new random salt after midnight UTC and never returns the old one", async () => {
    let now = NOON;
    const store = memorySaltStore(() => now);
    const today = Uint8Array.from(await store.saltForToday());
    now += DAY / 2;
    const tomorrow = await store.saltForToday();
    expect(tomorrow).not.toEqual(today);
    now += DAY;
    expect(await store.saltForToday()).not.toEqual(today);
  });

  it("derives nothing: two stores on the same day draw different salts", async () => {
    const a = await memorySaltStore(() => NOON).saltForToday();
    const b = await memorySaltStore(() => NOON).saltForToday();
    expect(a).not.toEqual(b);
  });

  it("offers no way to ask for another day", () => {
    const store = memorySaltStore(() => NOON);
    expect(Object.keys(store)).toEqual(["saltForToday"]);
    expect(store.saltForToday.length).toBe(0);
  });

  it("hashes the same IP differently on two days", async () => {
    let now = NOON;
    const store = memorySaltStore(() => now);
    const monday = hashIpPrefix("102.88.85.10", await store.saltForToday());
    now += DAY;
    expect(hashIpPrefix("102.88.85.10", await store.saltForToday())).not.toBe(monday);
  });
});

describe("kvSaltStore", () => {
  it("expires the salt at exactly the next UTC midnight, not a TTL from creation", async () => {
    const expiries: number[] = [];
    const inner = memoryKv(() => NOON);
    const kv: Kv = {
      ...inner,
      setIfAbsent: (key, value, expiresAtMs) => {
        expiries.push(expiresAtMs);
        return inner.setIfAbsent(key, value, expiresAtMs);
      },
    };
    await kvSaltStore(kv, () => NOON).saltForToday();
    expect(expiries).toEqual([Date.UTC(2026, 10, 3)]);
    expect(nextUtcMidnight(Date.UTC(2026, 10, 2, 23, 59, 59, 999))).toBe(Date.UTC(2026, 10, 3));
    expect(nextUtcMidnight(Date.UTC(2026, 10, 3))).toBe(Date.UTC(2026, 10, 4));
    expect(nextUtcMidnight(Date.UTC(2026, 11, 31, 12))).toBe(Date.UTC(2027, 0, 1));
  });

  it("gives every caller the same salt for the day, and a new one the next day", async () => {
    let time = NOON;
    const kv = memoryKv(() => time);
    const a = await kvSaltStore(kv, () => time).saltForToday();
    const b = await kvSaltStore(kv, () => time).saltForToday();
    expect(b).toEqual(a);
    expect(a.byteLength).toBe(32);
    time = NOON + DAY;
    expect(await kvSaltStore(kv, () => time).saltForToday()).not.toEqual(a);
  });

  it("is gone from the store once the day ends", async () => {
    let time = NOON;
    const kv = memoryKv(() => time);
    await kvSaltStore(kv, () => time).saltForToday();
    time = Date.UTC(2026, 10, 3);
    expect(await kv.get("salt:2026-11-02")).toBeNull();
  });
});
