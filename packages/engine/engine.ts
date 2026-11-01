import { gradeBufferbloat, runIdleLatency } from "./latency";
import {
  DOWNLOAD_SHARE,
  LOW_DATA_PROFILE,
  PAYLOAD_SHARE,
  type Phase,
  STANDARD_PROFILE,
} from "./profiles";
import { EngineFailure, type RunContext, now } from "./runtime";
import { ByteBudget, runThroughputPhase } from "./transfer";
import type {
  EngineError,
  FetchFn,
  SpeedTest,
  SpeedTestEvents,
  SpeedTestOptions,
  SpeedTestOutcome,
} from "./types";

export const ENGINE_VERSION = "0.1.0";

const MIN_MAX_BYTES = 1_000_000;
const MIN_MAX_DURATION_MS = 10_000;
/** Phases stop this early, so aborting requests and building the result still fit the limit. */
const CLEANUP_MARGIN_MS = 100;
const PHASES: readonly Phase[] = ["latency", "download", "upload"];

function validate(name: string, value: number | undefined, min: number): void {
  if (value !== undefined && !(Number.isFinite(value) && value >= min)) {
    throw new RangeError(`${name} must be a finite number of at least ${min}.`);
  }
}

type Listeners = { [K in keyof SpeedTestEvents]: Set<(event: SpeedTestEvents[K]) => void> };

export function createSpeedTest(options: SpeedTestOptions): SpeedTest {
  validate("maxBytes", options.maxBytes, MIN_MAX_BYTES);
  validate("maxDurationMs", options.maxDurationMs, MIN_MAX_DURATION_MS);

  const lowData = options.lowData ?? false;
  const profile = lowData ? LOW_DATA_PROFILE : STANDARD_PROFILE;
  const maxBytes = options.maxBytes ?? profile.maxBytes;
  const maxDurationMs = options.maxDurationMs ?? profile.maxDurationMs;
  const { endpoint } = options;
  // Wrapped so the caller's fetch is never called as a method of the run context: a native fetch
  // with a foreign `this` throws "Illegal invocation" in browsers (not in Node).
  const custom = options.fetch;
  const fetchFn: FetchFn = custom
    ? (input, init) => custom(input, init)
    : (input, init) => globalThis.fetch(input, init);

  const listeners: Listeners = { progress: new Set(), complete: new Set(), error: new Set() };
  const controller = new AbortController();
  let outcome: SpeedTestOutcome | undefined;
  let running: Promise<SpeedTestOutcome> | undefined;
  let phase: Phase = "latency";

  function emit<K extends keyof SpeedTestEvents>(type: K, event: SpeedTestEvents[K]): void {
    for (const listener of listeners[type]) {
      try {
        listener(event);
      } catch (error) {
        console.error(error);
      }
    }
  }

  /** Settles the run once: later calls return the first outcome. */
  function settle(next: SpeedTestOutcome): SpeedTestOutcome {
    if (outcome) return outcome;
    outcome = next;
    controller.abort();
    if (next.status === "complete") emit("complete", next.result);
    else emit("error", next.error);
    return next;
  }

  function fail(code: EngineError["code"], message: string, status?: number): SpeedTestOutcome {
    const error: EngineError = { code, message, phase };
    if (status !== undefined) error.status = status;
    return settle({ status: "error", error });
  }

  async function run(): Promise<SpeedTestOutcome> {
    const startedAt = now();
    const measuredAt = new Date().toISOString();
    const deadline = startedAt + maxDurationMs - CLEANUP_MARGIN_MS;
    const usage = { bytes: 0 };
    const ctx: RunContext = {
      fetchFn,
      endpoint,
      profile,
      signal: controller.signal,
      deadline,
      usage,
      progress: (event) => {
        emit("progress", { ...event, elapsedMs: now() - startedAt, bytesUsed: usage.bytes });
      },
    };

    /** The phase's share of the time left, so a slow warm-up shrinks every later phase alike. */
    const phaseDeadline = (current: Phase): number => {
      const time = now();
      const limit = profile.phaseLimitMs[current];
      const rest = PHASES.slice(PHASES.indexOf(current)).reduce(
        (sum, later) => sum + profile.phaseLimitMs[later],
        0,
      );
      return time + Math.min(limit, (Math.max(0, deadline - time) * limit) / rest);
    };

    try {
      const idle = await runIdleLatency(ctx, () => phaseDeadline("latency"));

      phase = "download";
      const payload = Math.floor(maxBytes * PAYLOAD_SHARE);
      const downloadBudget = new ByteBudget(payload * DOWNLOAD_SHARE);
      const download = await runThroughputPhase(ctx, {
        direction: "download",
        budget: downloadBudget,
        deadline: phaseDeadline("download"),
        idleRttMs: idle.medianMs,
      });

      phase = "upload";
      const reservedForDownload = Math.floor(payload * DOWNLOAD_SHARE) - downloadBudget.remaining;
      const upload = await runThroughputPhase(ctx, {
        direction: "upload",
        budget: new ByteBudget(payload - reservedForDownload),
        deadline: phaseDeadline("upload"),
        idleRttMs: idle.medianMs,
      });

      const addedLatencyMs = Math.max(
        0,
        Math.max(download.loadedMs, upload.loadedMs) - idle.medianMs,
      );
      return settle({
        status: "complete",
        result: {
          downloadMbps: download.mbps,
          uploadMbps: upload.mbps,
          latency: {
            idleMedianMs: idle.medianMs,
            idleP95Ms: idle.p95Ms,
            jitterMs: idle.jitterMs,
            requestLossPct: idle.requestLossPct,
          },
          loadedLatency: {
            downloadMs: download.loadedMs,
            uploadMs: upload.loadedMs,
            grade: gradeBufferbloat(addedLatencyMs),
          },
          bytesUsed: usage.bytes,
          durationMs: now() - startedAt,
          lowDataMode: lowData,
          engineVersion: ENGINE_VERSION,
          serverId: endpoint.id,
          measuredAt,
          addedLatencyMs,
          stoppedBy: { download: download.stoppedBy, upload: upload.stoppedBy },
        },
      });
    } catch (error) {
      if (outcome) return outcome;
      if (error instanceof EngineFailure) return fail(error.code, error.message, error.status);
      console.error(error);
      return fail("network-lost", "The test stopped unexpectedly.");
    }
  }

  return {
    start() {
      running ??= outcome ? Promise.resolve(outcome) : run();
      return running;
    },
    cancel() {
      fail("cancelled", "The test was cancelled.");
    },
    on(type, listener) {
      listeners[type].add(listener);
      return () => {
        listeners[type].delete(listener);
      };
    },
  };
}
