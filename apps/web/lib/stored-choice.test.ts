import { afterEach, describe, expect, it, vi } from "vitest";
import { storedChoice } from "./stored-choice";

afterEach(() => {
  vi.unstubAllGlobals();
});

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};

describe("storedChoice", () => {
  it("reads back only its own values", () => {
    const choice = storedChoice("test.a", ["x", "y"] as const);
    const storage = memory();
    expect(choice.read(() => storage)).toBeNull();
    choice.write("y", () => storage);
    expect(choice.read(() => storage)).toBe("y");
    storage.setItem("test.a", "z");
    expect(choice.read(() => storage)).toBeNull();
  });

  it("tells subscribers about writes here and in other tabs, for its own key only", () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const choice = storedChoice("test.b", ["x"] as const);
    const listener = vi.fn();
    const unsubscribe = choice.subscribe(listener);

    choice.write("x", memory);
    expect(listener).toHaveBeenCalledTimes(1);

    const storageEvent = (key: string) => Object.assign(new Event("storage"), { key });
    target.dispatchEvent(storageEvent("test.b"));
    target.dispatchEvent(storageEvent("other.key"));
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    choice.write("x", memory);
    target.dispatchEvent(storageEvent("test.b"));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
