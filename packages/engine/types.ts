import type { SpeedTestResult } from "@kilomita/shared";
import type { TestEndpoint } from "./endpoint";
import type { Direction, Phase } from "./profiles";

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export interface SpeedTestOptions {
  /**
   * Candidate servers, at least one unless `fallback` is set. With a choice to make (more than one,
   * or a fallback), the engine picks the lowest-latency candidate that answers, else the fallback.
   */
  endpoints: readonly TestEndpoint[];
  /** Used only when no candidate is usable. */
  fallback?: TestEndpoint;
  /** Smaller payloads and shorter phases. */
  lowData?: boolean;
  /** Hard data cap in bytes, at least 1 MB. Defaults to the profile's (50 MB, or 10 MB low-data). */
  maxBytes?: number;
  /**
   * Hard deadline in ms, at least 10 s. Defaults to the profile's (30 s, or 15 s low-data). Near the
   * floor, a slow 2G connection warm-up (up to 6 s) can leave upload too little time to finish a
   * request, which ends in a clear error rather than a hang.
   */
  maxDurationMs?: number;
  /** Transport. Defaults to the global fetch. */
  fetch?: FetchFn;
}

export type StopReason = "stable" | "time" | "data-cap";

/** `select` is the search for a server, before any measurement. */
export type RunPhase = "select" | Phase;

export interface ProgressEvent {
  phase: RunPhase;
  elapsedMs: number;
  bytesUsed: number;
  /** Live throughput during the download and upload phases. */
  currentMbps: number | null;
  /** The latest latency sample, idle or under load. */
  latencyMs: number | null;
}

export type EngineResult = Pick<
  SpeedTestResult,
  | "downloadMbps"
  | "uploadMbps"
  | "latency"
  | "loadedLatency"
  | "bytesUsed"
  | "durationMs"
  | "lowDataMode"
  | "engineVersion"
  | "serverId"
  | "measuredAt"
> & {
  /** Latency added under load: the larger loaded median minus the idle median. Graded A–F. */
  addedLatencyMs: number;
  /** 95th-percentile latency under load per phase, from the same probes as the loaded medians. */
  loadedP95Ms: Record<Direction, number>;
  /** Why each throughput phase ended. "data-cap" means it stopped early to save data. */
  stoppedBy: Record<Direction, StopReason>;
};

export type EngineErrorCode = "cancelled" | "network-lost" | "endpoint-error" | "no-server";

export interface EngineError {
  code: EngineErrorCode;
  message: string;
  phase: RunPhase;
  /** HTTP status, for endpoint errors caused by one. */
  status?: number;
}

export type SpeedTestOutcome =
  { status: "complete"; result: EngineResult } | { status: "error"; error: EngineError };

export interface SpeedTestEvents {
  progress: ProgressEvent;
  complete: EngineResult;
  error: EngineError;
}

export interface SpeedTest {
  /** Runs the test once. Resolves when it ends; never rejects. A second call returns the same promise. */
  start(): Promise<SpeedTestOutcome>;
  /** Stops the test and reports a "cancelled" error. Does nothing once the test has ended. */
  cancel(): void;
  /** Returns a function that removes the listener. */
  on<K extends keyof SpeedTestEvents>(
    type: K,
    listener: (event: SpeedTestEvents[K]) => void,
  ): () => void;
}
