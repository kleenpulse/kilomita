import { LoadedProbes } from "./latency";
import type { Direction } from "./profiles";
import {
  EngineFailure,
  MAX_CONSECUTIVE_FAILURES,
  RETRY_DELAY_MS,
  type RunContext,
  ServerError,
  discardBody,
  linkSignal,
  now,
  retriesExhausted,
  sleep,
  statusError,
  watchdog,
} from "./runtime";
import { interquartileMean, mean, median, percentile } from "./stats";
import {
  TICK_MS,
  ThroughputMeter,
  WINDOW_SAMPLES,
  eligibleSamples,
  finalEstimate,
  findWarmupEnd,
  isStable,
  windowEstimate,
} from "./throughput";
import type { StopReason } from "./types";

/** A new stream must raise throughput by this factor for the ramp to continue. */
const RAMP_GAIN = 1.1;
/** Settled samples on each side of a stream addition that the ramp compares. */
const RAMP_SAMPLES = 2;
/** Requests last at least this many idle round trips, so waiting for the response stays small. */
const RTT_FLOOR = 8;

/** A byte allowance. Reservations are never returned, so the total can't be exceeded. */
export class ByteBudget {
  #remaining: number;

  constructor(total: number) {
    this.#remaining = Math.max(0, Math.floor(total));
  }

  get remaining(): number {
    return this.#remaining;
  }

  reserve(wanted: number): number {
    const bytes = Math.max(0, Math.min(Math.floor(wanted), this.#remaining));
    this.#remaining -= bytes;
    return bytes;
  }
}

export interface SizeInput {
  /** This stream's last request rate in bytes per ms, or null before its first request. */
  rate: number | null;
  targetMs: number;
  idleRttMs: number;
  minBytes: number;
  maxBytes: number;
  remaining: number;
  streams: number;
}

/**
 * Bytes for a stream's next request: enough to last the target time (and several round trips) at
 * the stream's last rate. Returns 0 once the budget can't give every stream a minimum request,
 * rather than sending small requests that mostly measure round trips.
 */
export function nextRequestSize(input: SizeInput): number {
  const share = Math.floor(input.remaining / Math.max(1, input.streams));
  if (share < input.minBytes) return 0;
  if (input.rate === null) return input.minBytes;
  const wanted = input.rate * Math.max(input.targetMs, RTT_FLOOR * input.idleRttMs);
  return Math.floor(Math.min(Math.max(wanted, input.minBytes), input.maxBytes, share));
}

/**
 * How long a phase may go without progress before the line counts as lost. Download progress is any
 * byte. Upload has no progress events, so it waits for a POST to complete, and allows twice the last
 * one's duration, so a working 2G upload isn't mistaken for a dead line.
 */
export function stallLimitMs(
  direction: Direction,
  stallTimeoutMs: number,
  lastUploadMs: number,
): number {
  return direction === "upload" ? Math.max(stallTimeoutMs, 2 * lastUploadMs) : stallTimeoutMs;
}

/** Incompressible bytes (xorshift32), so proxies that compress traffic can't inflate uploads. */
export function makePayload(size: number): Uint8Array<ArrayBuffer> {
  const words = new Uint32Array(Math.ceil(size / 4));
  let state = 0x9e3779b9;
  for (let i = 0; i < words.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    words[i] = state >>> 0;
  }
  return new Uint8Array(words.buffer, 0, size);
}

export interface PhaseInput {
  direction: Direction;
  budget: ByteBudget;
  deadline: number;
  idleRttMs: number;
}

export interface PhaseOutcome {
  mbps: number;
  stoppedBy: StopReason;
  /** Median latency under load. */
  loadedMs: number;
  /** 95th-percentile latency under load, from the same samples. */
  loadedP95Ms: number;
}

export function runThroughputPhase(ctx: RunContext, input: PhaseInput): Promise<PhaseOutcome> {
  return new ThroughputPhase(ctx, input).run();
}

class ThroughputPhase {
  readonly #ctx: RunContext;
  readonly #input: PhaseInput;
  readonly #origin = now();
  readonly #meter: ThroughputMeter;
  readonly #link: { controller: AbortController; dispose: () => void };
  /** Started by the first byte that moves: a probe sent before that would measure an idle line. */
  #loaded: LoadedProbes | undefined;
  readonly #payload: Uint8Array<ArrayBuffer> | undefined;
  readonly #workers: Promise<void>[] = [];
  readonly #view = {
    samples: [] as number[],
    warmupEnd: null as number | null,
    discarded: new Set<number>(),
  };

  #fatal: EngineFailure | undefined;
  #inFlight = 0;
  #capReached = false;
  #stopping = false;
  #consecutiveFailures = 0;
  #lastFailureStatus: number | undefined;
  #lastProgressAt: number;
  #lastUploadMs = 0;
  #lastLoadedMs: number | null = null;
  #uploadProbesScheduled = false;
  #rampDone = false;
  #rampAnchor: { firstTick: number; before: number } | null = null;
  /** First tick the stability window may use: after the last stream addition. */
  #fromTick = 0;
  #estimates: number[] = [];
  #evaluated = 0;

  constructor(ctx: RunContext, input: PhaseInput) {
    this.#ctx = ctx;
    this.#input = input;
    this.#meter = new ThroughputMeter(this.#origin);
    this.#lastProgressAt = this.#origin;
    this.#link = linkSignal(ctx.signal);
    this.#payload =
      input.direction === "upload"
        ? makePayload(Math.min(ctx.profile.maxRequestBytes.upload, input.budget.remaining))
        : undefined;
  }

  /** Upload bytes leave at once but take about a round trip to queue up, so probes wait that long. */
  async #startUploadProbes(): Promise<void> {
    if (this.#uploadProbesScheduled) return;
    this.#uploadProbesScheduled = true;
    const signal = this.#link.controller.signal;
    await sleep(this.#input.idleRttMs, signal);
    if (!signal.aborted) this.#startLoadedProbes();
  }

  #startLoadedProbes(): void {
    this.#loaded ??= new LoadedProbes(
      this.#ctx,
      (ms) => {
        this.#lastLoadedMs = ms;
      },
      (error) => {
        this.#fail(error);
      },
    );
  }

  async run(): Promise<PhaseOutcome> {
    this.#addStream();
    try {
      return await this.#finish(await this.#loop());
    } finally {
      this.#stopping = true;
      this.#link.controller.abort();
      await Promise.allSettled(this.#workers);
      await this.#loaded?.abort();
      this.#link.dispose();
    }
  }

  async #loop(): Promise<StopReason> {
    const { deadline, direction } = this.#input;
    for (;;) {
      await sleep(Math.min(TICK_MS, deadline - now()), this.#link.controller.signal);
      if (this.#fatal) throw this.#fatal;
      this.#ctx.signal.throwIfAborted();

      const time = now();
      this.#updateSamples(this.#meter.settledUntil(time), false);
      this.#rampStep(time);
      const stable = this.#checkStability();
      this.#ctx.progress({
        phase: direction,
        currentMbps: this.#liveMbps(),
        latencyMs: this.#lastLoadedMs,
      });
      this.#checkStall(time);

      if (this.#capReached && this.#inFlight === 0) return "data-cap";
      if (stable) return "stable";
      if (time >= deadline) return "time";
    }
  }

  async #finish(stoppedBy: StopReason): Promise<PhaseOutcome> {
    this.#stopping = true;
    const end = now();
    this.#updateSamples(this.#meter.settledUntil(end), true);
    const estimate = stoppedBy === "stable" ? this.#estimates.at(-1) : finalEstimate(this.#view);
    const elapsed = end - this.#origin;
    const mbps =
      estimate ??
      (this.#meter.totalBytes > 0 && elapsed > 0
        ? (this.#meter.totalBytes * 8) / (elapsed * 1000)
        : null);
    if (mbps === null) throw new EngineFailure("network-lost", "No data could be transferred.");
    const warmupEndAt =
      this.#origin + (this.#view.warmupEnd ?? this.#view.samples.length) * TICK_MS;
    // A phase shorter than the upload probe delay hasn't probed yet: probe now, as a lower bound.
    this.#startLoadedProbes();

    // End the transfers first; a probe already in flight was sent under load and still counts. If
    // the only probes so far failed, the retry sees a line just unloaded: a lower bound, not a fail.
    this.#link.controller.abort();
    await Promise.allSettled(this.#workers);
    await this.#loaded?.stop(this.#ctx.deadline);
    // A probe answered with a 4xx while stop() waited.
    if (this.#fatal) throw this.#fatal;

    const loaded = this.#loaded?.samples ?? [];
    // Every probe under load failed.
    if (loaded.length === 0) throw retriesExhausted(this.#loaded?.lastFailureStatus);
    const afterWarmup = loaded.filter((sample) => sample.at >= warmupEndAt);
    const loadedSamples = (afterWarmup.length > 0 ? afterWarmup : loaded).map(
      (sample) => sample.ms,
    );
    return {
      mbps,
      stoppedBy,
      loadedMs: median(loadedSamples),
      loadedP95Ms: percentile(loadedSamples, 0.95),
    };
  }

  #updateSamples(until: number, includePartial: boolean): void {
    this.#view.samples = this.#meter.samples(until, includePartial);
    this.#view.warmupEnd ??= findWarmupEnd(this.#view.samples);
  }

  #addStream(at?: number, before?: number): void {
    if (at !== undefined && before !== undefined) {
      const tick = Math.floor((at - this.#origin) / TICK_MS);
      this.#view.discarded.add(tick).add(tick + 1);
      this.#rampAnchor = { firstTick: tick + 2, before };
      this.#fromTick = tick + 2;
      this.#estimates = [];
    }
    this.#workers.push(this.#worker());
  }

  /**
   * Adds a stream while the last one raised throughput by 10%. Each decision waits for settled
   * samples after the addition; before that the effect isn't measurable yet.
   */
  #rampStep(time: number): void {
    if (this.#rampDone) return;
    const { samples } = this.#view;
    const maxStreams = this.#ctx.profile.maxStreams[this.#input.direction];
    if (this.#workers.length >= maxStreams || this.#capReached) {
      this.#rampDone = true;
      return;
    }
    const anchor = this.#rampAnchor;
    if (anchor === null) {
      if (samples.filter((sample) => sample > 0).length >= RAMP_SAMPLES) {
        this.#addStream(time, mean(samples.slice(-RAMP_SAMPLES)));
      }
      return;
    }
    const after = samples.slice(anchor.firstTick);
    if (after.length < RAMP_SAMPLES) return;
    const gain = mean(after.slice(0, RAMP_SAMPLES)) / anchor.before;
    if (gain >= RAMP_GAIN) this.#addStream(time, mean(samples.slice(-RAMP_SAMPLES)));
    else this.#rampDone = true;
  }

  /** One window estimate per newly settled sample, once the ramp is done and a full window exists. */
  #checkStability(): boolean {
    const { samples } = this.#view;
    if (!this.#rampDone) {
      this.#evaluated = samples.length;
      return false;
    }
    for (; this.#evaluated < samples.length; this.#evaluated++) {
      const view = { ...this.#view, samples: samples.slice(0, this.#evaluated + 1) };
      const eligible = eligibleSamples(view, this.#fromTick);
      if (eligible.length >= WINDOW_SAMPLES) this.#estimates.push(windowEstimate(eligible));
    }
    return isStable(this.#estimates, this.#ctx.profile.stabilityTolerance);
  }

  #liveMbps(): number | null {
    const latest = this.#estimates.at(-1);
    if (latest !== undefined) return latest;
    const { samples } = this.#view;
    return samples.length > 0 ? interquartileMean(samples.slice(-WINDOW_SAMPLES)) : null;
  }

  #checkStall(time: number): void {
    if (this.#capReached && this.#inFlight === 0) return;
    const limit = stallLimitMs(
      this.#input.direction,
      this.#ctx.profile.stallTimeoutMs,
      this.#lastUploadMs,
    );
    if (time - this.#lastProgressAt >= limit) {
      throw new EngineFailure("network-lost", "The connection stalled.");
    }
  }

  /** The phase is over: it finished, failed or the run was cancelled. */
  #ended(): boolean {
    return this.#link.controller.signal.aborted;
  }

  #fail(error: EngineFailure): void {
    this.#fatal ??= error;
    this.#link.controller.abort();
  }

  async #worker(): Promise<void> {
    const signal = this.#link.controller.signal;
    const { direction, budget, idleRttMs } = this.#input;
    const { profile, endpoint } = this.#ctx;
    const maxBytes =
      direction === "download"
        ? Math.min(profile.maxRequestBytes.download, endpoint.maxDownloadBytes)
        : Math.min(profile.maxRequestBytes.upload, this.#payload?.byteLength ?? 0);
    let rate: number | null = null;

    while (!this.#stopping && !this.#capReached && !this.#ended()) {
      const size = nextRequestSize({
        rate,
        targetMs: profile.requestTargetMs[direction],
        idleRttMs,
        minBytes: profile.minRequestBytes[direction],
        maxBytes,
        remaining: budget.remaining,
        streams: this.#workers.length,
      });
      if (size === 0) {
        this.#capReached = true;
        return;
      }
      const bytes = budget.reserve(size);
      const sentAt = now();
      let failed = false;
      this.#inFlight++;
      try {
        if (direction === "download") await this.#download(bytes, signal);
        else await this.#upload(bytes, signal);
        // Time spent moving bytes, without the round trip spent waiting. At most half the request
        // counts as waiting, so RTT jitter can't inflate the rate into a huge next request.
        const duration = now() - sentAt;
        rate = bytes / Math.max(1, duration - idleRttMs, duration / 2);
      } catch (error) {
        if (this.#ended()) return;
        if (error instanceof EngineFailure) {
          this.#fail(error);
          return;
        }
        this.#consecutiveFailures++;
        this.#lastFailureStatus = error instanceof ServerError ? error.status : undefined;
        if (this.#consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.#fail(retriesExhausted(this.#lastFailureStatus));
          return;
        }
        failed = true;
      } finally {
        this.#inFlight--;
      }
      if (failed) await sleep(RETRY_DELAY_MS, signal);
    }
  }

  /**
   * A request that stops making progress is aborted and retried as a failure. An open but silent
   * transfer would otherwise hold back the settled boundary, freezing the reading and the ramp while
   * the other streams spend data unseen (one stuck HTTP/1.1 connection, or a dead CGNAT mapping).
   */
  async #download(bytes: number, signal: AbortSignal): Promise<void> {
    const request = linkSignal(signal);
    const inactivity = watchdog(request.controller, this.#ctx.profile.stallTimeoutMs);
    try {
      const response = await this.#ctx.fetchFn(this.#ctx.endpoint.downloadUrl(bytes), {
        signal: request.controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        await discardBody(response);
        throw statusError(response.status);
      }
      if (response.body === null) throw new TypeError("The download response had no body.");
      const reader = response.body.getReader();
      const id = this.#meter.open(now());
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          const at = now();
          inactivity.touch();
          this.#startLoadedProbes();
          this.#meter.record(id, at, value.byteLength);
          this.#ctx.usage.bytes += value.byteLength;
          this.#lastProgressAt = at;
          this.#consecutiveFailures = 0;
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        throw error;
      } finally {
        this.#meter.close(id);
      }
    } finally {
      inactivity.clear();
      request.dispose();
    }
  }

  async #upload(bytes: number, signal: AbortSignal): Promise<void> {
    if (this.#payload === undefined) throw new Error("No upload payload.");
    // Counted when sent: the browser may have pushed all of it before an abort.
    this.#ctx.usage.bytes += bytes;
    void this.#startUploadProbes();
    const { stallTimeoutMs } = this.#ctx.profile;
    const request = linkSignal(signal);
    const inactivity = watchdog(
      request.controller,
      stallLimitMs("upload", stallTimeoutMs, this.#lastUploadMs),
    );
    const sentAt = now();
    const id = this.#meter.open(sentAt);
    try {
      const response = await this.#ctx.fetchFn(this.#ctx.endpoint.uploadUrl(), {
        method: "POST",
        body: this.#payload.subarray(0, bytes),
        signal: request.controller.signal,
        cache: "no-store",
      });
      await discardBody(response);
      if (!response.ok) throw statusError(response.status);
      const at = now();
      this.#meter.record(id, at, bytes);
      this.#lastProgressAt = at;
      this.#lastUploadMs = at - sentAt;
      this.#consecutiveFailures = 0;
    } finally {
      this.#meter.close(id);
      inactivity.clear();
      request.dispose();
    }
  }
}
