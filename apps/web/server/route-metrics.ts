import { after } from "next/server";
import { type Recorder, failureField, recordEvents, recorder } from "./metrics";
import { getStores } from "./stores";

/*
 * Glue for app/api: counters are written after the response through Next's after(), which keeps
 * the work alive on serverless hosts once the answer has gone. Without stores nothing is counted.
 */

const schedule = (task: () => Promise<void>) => {
  after(task);
};

export async function routeRecorder(): Promise<Recorder> {
  return recorder((await getStores())?.kv, schedule);
}

/** guarded()'s onFailure: counts error:<event>:<code> for /status. */
export function countFailure(event: string, code: string): void {
  schedule(async () => {
    const stores = await getStores();
    if (stores) await recordEvents(stores.kv, [failureField(event, code)], Date.now());
  });
}
