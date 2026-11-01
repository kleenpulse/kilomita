// Runs one speed test off the main thread, so page work can't delay the engine's timing.
import { cloudflareEndpoint, createSpeedTest } from "@kilomita/engine";
import type { ProgressEvent, SpeedTestOutcome } from "@kilomita/engine";

export interface StartCommand {
  lowData: boolean;
}

export type WorkerReply =
  { type: "progress"; event: ProgressEvent } | { type: "done"; outcome: SpeedTestOutcome };

function reply(message: WorkerReply): void {
  postMessage(message);
}

let started = false;

addEventListener("message", (event: MessageEvent<StartCommand>) => {
  if (started) return;
  started = true;
  // Cloudflare is for development and manual testing only (see CLAUDE.md, launch blocker).
  const test = createSpeedTest({ endpoint: cloudflareEndpoint, lowData: event.data.lowData });
  test.on("progress", (progress) => {
    reply({ type: "progress", event: progress });
  });
  void test.start().then((outcome) => {
    reply({ type: "done", outcome });
  });
});
