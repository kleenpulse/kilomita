// Runs one speed test off the main thread, so page work can't delay the engine's timing.
import { cloudflareEndpoint, createSpeedTest, selfHostedEndpoint } from "@kilomita/engine";
import type { ProgressEvent, SpeedTestOutcome } from "@kilomita/engine";
import type { RunServers } from "./sharing-api";

export interface StartCommand extends RunServers {
  lowData: boolean;
}

export type WorkerReply =
  /** Sent as soon as this script runs: an error before it means the script never loaded. */
  | { type: "ready" }
  | { type: "progress"; event: ProgressEvent }
  | { type: "done"; outcome: SpeedTestOutcome };

function reply(message: WorkerReply): void {
  postMessage(message);
}

reply({ type: "ready" });

let started = false;

addEventListener("message", (event: MessageEvent<StartCommand>) => {
  if (started) return;
  started = true;
  const { lowData, servers, fallback, ticket } = event.data;
  const endpoints =
    ticket === null ? [] : servers.map((server) => selfHostedEndpoint({ ...server, ticket }));
  // Cloudflare only when the deployment allows it (off in production: CLAUDE.md, launch blocker).
  const test = createSpeedTest({
    endpoints,
    ...(fallback ? { fallback: cloudflareEndpoint } : {}),
    lowData,
  });
  test.on("progress", (progress) => {
    reply({ type: "progress", event: progress });
  });
  void test.start().then((outcome) => {
    reply({ type: "done", outcome });
  });
});
