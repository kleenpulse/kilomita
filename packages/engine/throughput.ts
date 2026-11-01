import { interquartileMean, mean } from "./stats";

export const TICK_MS = 250;
/** The rolling window: 2 s of ticks. */
export const WINDOW_SAMPLES = 8;
/** Window estimates that must agree before a phase counts as stable (1 s of ticks). */
export const STABLE_ESTIMATES = 4;
/** A trailing partial tick shorter than this is too noisy to keep. */
const MIN_PARTIAL_TICK_MS = 50;
/** Warm-up lasts at most this many ticks after the first byte (1 s), and at least the minimum. */
const WARMUP_MAX_TICKS = 4;
const WARMUP_MIN_TICKS = 2;
const FLAT_GROWTH = 1.1;

interface Segment {
  start: number;
  end: number;
  bytes: number;
}

/**
 * Collects transferred bytes as time segments and turns them into per-tick Mbps samples.
 *
 * Download reads are short segments between reads. Upload has no progress events, so a POST is one
 * segment from send to response, spread evenly over its lifetime. With parallel streams the spread
 * segments add up to the link's throughput.
 */
export class ThroughputMeter {
  readonly #origin: number;
  readonly #segments: Segment[] = [];
  readonly #pending = new Map<number, number>();
  #nextId = 0;
  #totalBytes = 0;

  constructor(origin: number) {
    this.#origin = origin;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  /** Starts a transfer whose next bytes are counted from `since`. */
  open(since: number): number {
    const id = this.#nextId++;
    this.#pending.set(id, since);
    return id;
  }

  /** Records bytes that moved between the transfer's last record (or open) and `at`. */
  record(id: number, at: number, bytes: number): void {
    const since = this.#pending.get(id);
    if (since === undefined) throw new Error(`Transfer ${id} is not open.`);
    this.#segments.push({ start: since, end: at, bytes });
    this.#pending.set(id, at);
    this.#totalBytes += bytes;
  }

  close(id: number): void {
    this.#pending.delete(id);
  }

  /** No transfer can record bytes before this time, so ticks that end by then are final. */
  settledUntil(now: number): number {
    let settled = now;
    for (const since of this.#pending.values()) settled = Math.min(settled, since);
    return settled;
  }

  /**
   * Mbps for each whole tick between the origin and `until`. With `includePartial`, a trailing
   * partial tick is added, normalised by its real length.
   */
  samples(until: number, includePartial = false): number[] {
    const span = until - this.#origin;
    if (span <= 0) return [];
    const whole = Math.floor(span / TICK_MS);
    const partialMs = span - whole * TICK_MS;
    const count = whole + (includePartial && partialMs >= MIN_PARTIAL_TICK_MS ? 1 : 0);
    const bins = new Array<number>(count).fill(0);

    for (const { start, end, bytes } of this.#segments) {
      if (end <= start) {
        if (end > until) continue;
        const index = Math.max(0, Math.ceil((end - this.#origin) / TICK_MS) - 1);
        if (index < count) bins[index] = (bins[index] ?? 0) + bytes;
        continue;
      }
      const rate = bytes / (end - start);
      const to = Math.min(end, until);
      for (let i = Math.max(0, Math.floor((start - this.#origin) / TICK_MS)); i < count; i++) {
        const tickStart = this.#origin + i * TICK_MS;
        if (tickStart >= to) break;
        const overlap = Math.min(to, tickStart + TICK_MS) - Math.max(start, tickStart);
        if (overlap > 0) bins[i] = (bins[i] ?? 0) + rate * overlap;
      }
    }

    return bins.map((bytes, i) => (bytes * 8) / ((i < whole ? TICK_MS : partialMs) * 1000));
  }
}

/**
 * Index of the first tick after TCP slow start, or null while it can't be told yet. Warm-up ends
 * 1 s after the first byte, or earlier once two consecutive ticks each grew less than 10%, but
 * never within the first 2 ticks of data.
 */
export function findWarmupEnd(samples: readonly number[]): number | null {
  const first = samples.findIndex((sample) => sample > 0);
  if (first === -1) return null;
  for (let tick = first + 1; tick <= first + WARMUP_MAX_TICKS - 1; tick++) {
    const previous = samples[tick - 1];
    const current = samples[tick];
    const next = samples[tick + 1];
    if (previous === undefined || current === undefined || next === undefined) return null;
    if (current < previous * FLAT_GROWTH && next < current * FLAT_GROWTH) {
      return Math.max(tick, first + WARMUP_MIN_TICKS);
    }
  }
  return first + WARMUP_MAX_TICKS;
}

export interface SampleView {
  samples: readonly number[];
  warmupEnd: number | null;
  discarded: ReadonlySet<number>;
}

/** Post-warm-up samples that weren't discarded, from tick `from` on. */
export function eligibleSamples(view: SampleView, from = 0): number[] {
  if (view.warmupEnd === null) return [];
  const start = Math.max(view.warmupEnd, from);
  return view.samples.filter((_, tick) => tick >= start && !view.discarded.has(tick));
}

/** Interquartile mean of the latest full window. */
export function windowEstimate(eligible: readonly number[]): number {
  return interquartileMean(eligible.slice(-WINDOW_SAMPLES));
}

/**
 * The reading a phase reports when it stops: the latest window of post-warm-up samples. A very
 * short phase (a fast link hitting the data cap) falls back to its last samples, never to the
 * slow-start ones it could avoid. Null means there are no samples at all.
 */
export function finalEstimate(view: SampleView): number | null {
  const eligible = eligibleSamples(view);
  if (eligible.length >= STABLE_ESTIMATES) return windowEstimate(eligible);
  if (view.samples.length === 0) return null;
  return interquartileMean(view.samples.slice(-STABLE_ESTIMATES));
}

/** Stable when the last window estimates spread by no more than `tolerance` of their mean. */
export function isStable(estimates: readonly number[], tolerance: number): boolean {
  if (estimates.length < STABLE_ESTIMATES) return false;
  const last = estimates.slice(-STABLE_ESTIMATES);
  const average = mean(last);
  return average > 0 && Math.max(...last) - Math.min(...last) <= tolerance * average;
}
