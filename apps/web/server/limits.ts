import type { Kv } from "./kv";

/*
 * Rate limits key on what a request proves it holds (a signed token, an owned result), never on
 * the IP hash: on CGNAT carriers thousands of people share one /24. Before a token exists there is
 * nothing else to key on, so issuance and deletes only have global ceilings, as cost backstops.
 */
export const LIMITS = Object.freeze({
  submitAttemptsPerToken: 5,
  correctionsPerResult: 20,
  tokensPerMinute: 1_200,
  deletesPerMinute: 600,
});

const MINUTE = 60_000;

/** True while the counter for key is within max; each call counts once. */
export async function allow(kv: Kv, key: string, max: number, windowEndMs: number) {
  return (await kv.countInWindow(key, windowEndMs)) <= max;
}

/** A global per-minute counter: the key names the minute, so each one starts from zero. */
export function allowPerMinute(kv: Kv, name: string, max: number, now: number) {
  const minute = Math.floor(now / MINUTE);
  return allow(kv, `${name}:${String(minute)}`, max, (minute + 1) * MINUTE);
}
