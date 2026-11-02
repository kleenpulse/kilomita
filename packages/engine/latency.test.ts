import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gradeBufferbloat } from "./grade";
import { probe, runIdleLatency } from "./latency";
import { EngineFailure } from "./runtime";
import { blockRealNetwork, createSimulatedNetwork, testContext } from "./simulated-network";
import type { FetchFn } from "./types";

beforeEach(() => {
  vi.useFakeTimers();
  blockRealNetwork();
});

afterEach(() => {
  vi.useRealTimers();
});

type Step = { ms: number; status?: number; serverTiming?: string } | "fail" | "hang";

/** Answers each call with the next step; the last step repeats. Counts unconsumed bodies. */
function scripted(steps: Step[]): FetchFn & { open: () => number } {
  let call = 0;
  let open = 0;
  const fetch = (_input: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const step = steps[Math.min(call++, steps.length - 1)] ?? "fail";
      const aborted = () => {
        reject(new DOMException("Aborted", "AbortError"));
      };
      init.signal?.addEventListener("abort", aborted, { once: true });
      if (step === "hang") return;
      if (step === "fail") {
        setTimeout(() => {
          reject(new TypeError("Failed to fetch"));
        }, 10);
        return;
      }
      setTimeout(() => {
        open++;
        const body = new ReadableStream({
          pull(controller) {
            controller.close();
            open--;
          },
          cancel() {
            open--;
          },
        });
        const headers = new Headers(
          step.serverTiming ? { "server-timing": step.serverTiming } : {},
        );
        resolve(new Response(body, { status: step.status ?? 200, headers }));
      }, step.ms);
    });
  return Object.assign(fetch, { open: () => open });
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  const state = { done: false };
  void promise.finally(() => {
    state.done = true;
  });
  while (!state.done) await vi.advanceTimersByTimeAsync(10);
  return promise;
}

describe("gradeBufferbloat", () => {
  it.each([
    [0, "A"],
    [29.9, "A"],
    [30, "B"],
    [59.9, "B"],
    [60, "C"],
    [199.9, "C"],
    [200, "D"],
    [399.9, "D"],
    [400, "F"],
  ])("grades %s ms added latency as %s", (added, grade) => {
    expect(gradeBufferbloat(added)).toBe(grade);
  });
});

describe("probe", () => {
  it("subtracts the reported server time", async () => {
    const fetch = scripted([{ ms: 50, serverTiming: "cfSpeedWorker;dur=30" }]);
    const signal = new AbortController().signal;
    expect(await settle(probe(testContext(fetch), 3000, signal))).toEqual({ kind: "ok", ms: 20 });
  });

  it("clamps at 0 when the server reports more time than was measured", async () => {
    const fetch = scripted([{ ms: 20, serverTiming: "cfRequestDuration;dur=40" }]);
    const signal = new AbortController().signal;
    expect(await settle(probe(testContext(fetch), 3000, signal))).toEqual({ kind: "ok", ms: 0 });
  });

  it("releases every response body", async () => {
    const fetch = scripted([{ ms: 5 }, { ms: 5, status: 503 }]);
    const signal = new AbortController().signal;
    await settle(probe(testContext(fetch), 3000, signal));
    await settle(probe(testContext(fetch), 3000, signal));
    expect(fetch.open()).toBe(0);
  });

  it("times out at exactly its timeout on the fake clock", async () => {
    const result = probe(testContext(scripted(["hang"])), 3000, new AbortController().signal);
    let outcome: unknown;
    void result.then((value) => {
      outcome = value;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(outcome).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ kind: "timeout", ms: 3000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a cut, not a timeout, when the caller aborts", async () => {
    const controller = new AbortController();
    const result = probe(testContext(scripted(["hang"])), 3000, controller.signal);
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    expect(await result).toEqual({ kind: "cut" });
  });

  it("throws on a 4xx and reports a 5xx as a failure with its status", async () => {
    const signal = new AbortController().signal;
    const refused = probe(testContext(scripted([{ ms: 5, status: 429 }])), 3000, signal);
    const assertion = expect(refused).rejects.toMatchObject({
      code: "endpoint-error",
      status: 429,
    });
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    const failing = probe(testContext(scripted([{ ms: 5, status: 503 }])), 3000, signal);
    expect(await settle(failing)).toEqual({ kind: "failed", status: 503 });
  });
});

describe("runIdleLatency", () => {
  const deadline = () => performance.now() + 5000;

  it("excludes the warm-up probe, which pays for the connection setup", async () => {
    const network = createSimulatedNetwork({
      downMbps: 10,
      upMbps: 10,
      rttMs: 100,
      handshakeRtts: 5,
    });
    const result = await settle(runIdleLatency(testContext(network.fetch), deadline));
    expect(result).toMatchObject({ medianMs: 100, p95Ms: 100, jitterMs: 0, requestLossPct: 0 });
  });

  it("doesn't count failed warm-up attempts as loss", async () => {
    const fetch = scripted(["fail", "fail", "fail", { ms: 40 }]);
    const result = await settle(runIdleLatency(testContext(fetch), deadline));
    expect(result.requestLossPct).toBe(0);
    expect(result.medianMs).toBe(40);
  });

  it("counts timed-out and failed probes as request loss", async () => {
    const steps: Step[] = [{ ms: 50 }];
    for (let i = 0; i < 20; i++)
      steps.push(i % 4 === 3 ? (i % 8 === 3 ? "hang" : "fail") : { ms: 50 });
    const ctx = testContext(scripted(steps));
    const result = await settle(runIdleLatency(ctx, () => performance.now() + 60_000));
    expect(result.requestLossPct).toBe(25);
    expect(result.medianMs).toBe(50);
  });

  it("stops at its deadline without counting the cut probe as loss", async () => {
    const steps: Step[] = [{ ms: 50 }, { ms: 50 }, "hang"];
    const ctx = testContext(scripted(steps));
    const result = await settle(runIdleLatency(ctx, () => performance.now() + 1000));
    expect(result.requestLossPct).toBe(0);
  });

  it("fails by its last failure when no probe after the warm-up succeeds", async () => {
    const lost = runIdleLatency(testContext(scripted([{ ms: 50 }, "fail"])), deadline);
    const lostAssertion = expect(lost).rejects.toMatchObject({ code: "network-lost" });
    await vi.advanceTimersByTimeAsync(10_000);
    await lostAssertion;

    const erroring = runIdleLatency(
      testContext(scripted([{ ms: 50 }, { ms: 5, status: 502 }])),
      deadline,
    );
    const errorAssertion = expect(erroring).rejects.toMatchObject({
      code: "endpoint-error",
      status: 502,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await errorAssertion;
  });

  it("keeps the server's error when the warm-up window cuts its last probe short", async () => {
    // 503 after 400 ms, retried every 250 ms: the probe sent at 5,850 ms is cut at 6,000 ms.
    const result = runIdleLatency(testContext(scripted([{ ms: 400, status: 503 }])), deadline);
    const assertion = expect(result).rejects.toMatchObject({ code: "endpoint-error", status: 503 });
    await vi.advanceTimersByTimeAsync(6_500);
    await assertion;
  });

  it("gives up on the warm-up after the stall timeout", async () => {
    const result = runIdleLatency(testContext(scripted(["fail"])), deadline);
    const assertion = expect(result).rejects.toBeInstanceOf(EngineFailure);
    await vi.advanceTimersByTimeAsync(6_500);
    await assertion;
  });
});
