/*
 * A hard deadline for calls to Redis. The Upstash client retries a failed call five times with
 * backoff (about 4.3 s) and never times out a hung connection, so anything on a request's path,
 * or kept alive after it by after(), needs its own limit.
 */

export const TIMED_OUT: unique symbol = Symbol("timed out");

/** The task's result, or TIMED_OUT once ms have passed. The timer never outlives the race. */
export async function withinBudget<T>(task: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT);
    }, ms);
  });
  try {
    // Promise.race subscribes to task, so a rejection after the deadline is still handled.
    return await Promise.race([task, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
