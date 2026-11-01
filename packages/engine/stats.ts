function sortedCopy(values: readonly number[]): number[] {
  if (values.length === 0) throw new RangeError("Expected at least one value.");
  return [...values].sort((a, b) => a - b);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("Expected at least one value.");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Linear interpolation between the closest ranks (the NumPy default). `p` is in [0, 1]. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = sortedCopy(values);
  const rank = (sorted.length - 1) * p;
  const below = Math.floor(rank);
  const weight = rank - below;
  // The two closest ranks (just one at the top), each weighted by how near the rank lies.
  return sorted
    .slice(below, below + 2)
    .reduce((sum, value, i) => sum + value * (i === 0 ? 1 - weight : weight), 0);
}

export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/** Mean of the middle half: a quarter is trimmed from each end. Below 4 values nothing is trimmed. */
export function interquartileMean(values: readonly number[]): number {
  const sorted = sortedCopy(values);
  const cut = Math.floor(sorted.length / 4);
  return mean(sorted.slice(cut, sorted.length - cut));
}

/** Mean absolute difference between consecutive samples, as Cloudflare's speed test computes it. */
export function jitter(samples: readonly number[]): number {
  let total = 0;
  let previous: number | undefined;
  for (const sample of samples) {
    if (previous !== undefined) total += Math.abs(sample - previous);
    previous = sample;
  }
  return samples.length < 2 ? 0 : total / (samples.length - 1);
}
