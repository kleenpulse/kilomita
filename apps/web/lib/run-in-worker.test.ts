import { describe, expect, it } from "vitest";
import { startRun } from "./run-in-worker";
import type { StartCommand } from "./speed-test.worker";

/** A stand-in Worker that the test drives by hand. */
function fakeWorker() {
  const listeners: Record<string, ((event: unknown) => void)[]> = { message: [], error: [] };
  const posted: unknown[] = [];
  let terminated = false;
  return {
    worker: {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        (listeners[type] ??= []).push(listener);
      },
      postMessage: (message: unknown) => {
        posted.push(message);
      },
      terminate: () => {
        terminated = true;
      },
    },
    send: (data: unknown) => {
      for (const listener of listeners.message ?? []) listener({ data });
    },
    fail: () => {
      for (const listener of listeners.error ?? []) listener(new Event("error"));
    },
    posted,
    terminated: () => terminated,
  };
}

const command: StartCommand = {
  lowData: true,
  servers: [{ id: "lagos-1", origin: "https://lagos-1.kilomita.ng" }],
  fallback: false,
  ticket: "k1.x.y",
};

describe("startRun", () => {
  it("hands the Worker the servers and the ticket", () => {
    const fake = fakeWorker();
    startRun(
      command,
      () => undefined,
      () => fake.worker as never,
    );
    expect(fake.posted).toEqual([command]);
  });

  it("reports a Worker whose script never ran as not loaded (a stale page after a deploy)", async () => {
    const fake = fakeWorker();
    const run = startRun(
      command,
      () => undefined,
      () => fake.worker as never,
    );
    fake.fail();
    expect(await run.outcome).toEqual({ status: "crashed", loaded: false });
    expect(fake.terminated()).toBe(true);
  });

  it("reports a Worker that failed after it started as a crash", async () => {
    const fake = fakeWorker();
    const run = startRun(
      command,
      () => undefined,
      () => fake.worker as never,
    );
    fake.send({ type: "ready" });
    fake.fail();
    expect(await run.outcome).toEqual({ status: "crashed", loaded: true });
  });

  it("passes progress on and ends with the outcome", async () => {
    const fake = fakeWorker();
    const seen: unknown[] = [];
    const run = startRun(
      command,
      (event) => seen.push(event),
      () => fake.worker as never,
    );
    const event = {
      phase: "select",
      elapsedMs: 0,
      bytesUsed: 0,
      currentMbps: null,
      latencyMs: null,
    };
    fake.send({ type: "ready" });
    fake.send({ type: "progress", event });
    const error = { code: "no-server", message: "x", phase: "select" };
    fake.send({ type: "done", outcome: { status: "error", error } });
    expect(seen).toEqual([event]);
    expect(await run.outcome).toEqual({ status: "error", error });
  });

  it("stops for a lost connection", async () => {
    const fake = fakeWorker();
    const run = startRun(
      command,
      () => undefined,
      () => fake.worker as never,
    );
    run.stop("offline");
    expect(await run.outcome).toEqual({ status: "stopped", reason: "offline" });
    expect(fake.terminated()).toBe(true);
  });
});
