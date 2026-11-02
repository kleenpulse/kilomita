import { SHARING } from "@kilomita/shared/lists";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addPending,
  forget,
  newSecret,
  readShared,
  resetSharedMemory,
  setSharedId,
} from "./shared-results";

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

const NOW = Date.UTC(2026, 10, 2, 12);

beforeEach(() => {
  resetSharedMemory();
});

describe("shared results on this device", () => {
  it("keeps a pending entry before sending, then its id", () => {
    const storage = memoryStorage();
    addPending("s1", NOW, () => storage);
    expect(readShared(NOW, () => storage)).toEqual([{ id: null, secret: "s1", at: NOW }]);
    setSharedId("s1", "id-1", NOW, () => storage);
    expect(readShared(NOW, () => storage)).toEqual([{ id: "id-1", secret: "s1", at: NOW }]);
    expect([...storage.items.keys()]).toEqual(["kilomita.shared"]);
  });

  it("forgets deleted or refused secrets", () => {
    const storage = memoryStorage();
    for (const secret of ["a", "b", "c"]) addPending(secret, NOW, () => storage);
    forget(["a", "c"], NOW, () => storage);
    expect(readShared(NOW, () => storage).map((entry) => entry.secret)).toEqual(["b"]);
  });

  it("drops entries past retention, as the server does", () => {
    const storage = memoryStorage();
    addPending("old", NOW - SHARING.retentionMs, () => storage);
    addPending("new", NOW, () => storage);
    expect(readShared(NOW, () => storage).map((entry) => entry.secret)).toEqual(["new"]);
  });

  it("survives garbage in storage", () => {
    const storage = memoryStorage();
    storage.items.set("kilomita.shared", "{nope");
    expect(readShared(NOW, () => storage)).toEqual([]);
    storage.items.set(
      "kilomita.shared",
      JSON.stringify([{ secret: 1 }, { id: null, secret: "x", at: NOW }]),
    );
    expect(readShared(NOW, () => storage)).toEqual([{ id: null, secret: "x", at: NOW }]);
  });

  it("holds the list in memory when storage refuses writes, until reload", () => {
    const refusing = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    addPending("kept", NOW, () => refusing);
    expect(readShared(NOW, () => refusing).map((entry) => entry.secret)).toEqual(["kept"]);
  });
});

describe("newSecret", () => {
  it("is 32 random bytes as 43 base64url characters", () => {
    const a = newSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSecret()).not.toBe(a);
  });
});
