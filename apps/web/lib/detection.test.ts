import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDetection, parseDetection } from "./detection";

afterEach(() => {
  vi.useRealTimers();
});

describe("parseDetection", () => {
  it("keeps known slugs", () => {
    expect(parseDetection({ isp: "mtn", state: "lagos" })).toEqual({ isp: "mtn", state: "lagos" });
    expect(parseDetection({ isp: "other", state: null })).toEqual({ isp: "other", state: null });
  });

  it("drops anything not on our lists", () => {
    expect(parseDetection({ isp: "MTN", state: "Lagos" })).toEqual({ isp: null, state: null });
    expect(parseDetection({ isp: "fibreone", state: "atlantis" })).toEqual({
      isp: null,
      state: null,
    });
    expect(parseDetection({ isp: 1, state: ["lagos"] })).toEqual({ isp: null, state: null });
    for (const junk of [null, "mtn", 42, []]) {
      expect(parseDetection(junk)).toEqual({ isp: null, state: null });
    }
  });
});

describe("fetchDetection", () => {
  it("asks our own server, uncached", async () => {
    const fetchFn = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ isp: "glo", state: "kano" })),
    );
    expect(await fetchDetection(fetchFn)).toEqual({ isp: "glo", state: "kano" });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/network",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("detects nothing on an error status, bad JSON or a network failure", async () => {
    const answers: (() => Promise<Response>)[] = [
      () => Promise.resolve(new Response("oops", { status: 500 })),
      () => Promise.resolve(new Response("not json")),
      () => Promise.reject(new TypeError("Failed to fetch")),
    ];
    for (const answer of answers) {
      expect(await fetchDetection(answer)).toEqual({ isp: null, state: null });
    }
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const hanging: typeof fetch = (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    };
    const pending = fetchDetection(hanging, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ isp: null, state: null });
    expect(signal?.aborted).toBe(true);
  });
});
