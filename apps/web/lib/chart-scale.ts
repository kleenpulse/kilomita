/** A rounded axis top and evenly spaced ticks from 0 for values up to `max` (1, 2, 2.5 or 5 steps). */
export function niceScale(max: number, tickCount = 4): { top: number; ticks: number[] } {
  if (!(max > 0) || !Number.isFinite(max)) return { top: 1, ticks: [0, 1] };
  const rough = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((factor) => factor * magnitude)
      .find((candidate) => candidate >= rough) ?? 10 * magnitude;
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) =>
    Number((i * step).toPrecision(12)),
  );
  return { top: Number(top.toPrecision(12)), ticks };
}

/** Maps a value in [0, top] to a y coordinate in a plot from `bottom` (value 0) up to `topY`. */
export function scaleY(value: number, top: number, bottom: number, topY: number): number {
  return bottom - (Math.min(Math.max(value, 0), top) / top) * (bottom - topY);
}
