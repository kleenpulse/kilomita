/** Mbps with as many decimals as a phone screen needs: 0.85, 8.4, 23, 245. */
export function formatMbps(mbps: number): string {
  // Banded on the rounded value, so 9.96 reads "10", not "10.0".
  if (mbps < 0.995) return mbps.toFixed(2);
  if (mbps < 9.95) return mbps.toFixed(1);
  return String(Math.round(mbps));
}

export function formatMs(ms: number): string {
  return `${String(Math.round(ms))} ms`;
}

/** Decimal megabytes (1 MB = 1,000,000 bytes), the unit the engine's caps use. */
export function formatMegabytes(bytes: number): string {
  const megabytes = bytes / 1_000_000;
  if (bytes > 0 && megabytes < 0.1) return "<0.1 MB";
  return `${megabytes.toFixed(1)} MB`;
}

export function formatSeconds(ms: number): string {
  return `${String(Math.round(ms / 1000))} s`;
}
