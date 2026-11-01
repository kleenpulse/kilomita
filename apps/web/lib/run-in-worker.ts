import type { EngineError, EngineResult, ProgressEvent } from "@kilomita/engine";
import type { StartCommand, WorkerReply } from "./speed-test.worker";

export type StopReason = "user" | "hidden";

export type RunOutcome =
  | { status: "complete"; result: EngineResult }
  | { status: "error"; error: EngineError }
  | { status: "stopped"; reason: StopReason }
  | { status: "crashed" };

export interface Run {
  readonly outcome: Promise<RunOutcome>;
  /** Ends the run at once: the Worker is terminated, which also aborts its requests. */
  stop(reason: StopReason): void;
}

/** One Worker per run, created here and terminated when the run ends, however it ends. */
export function startRun(lowData: boolean, onProgress: (event: ProgressEvent) => void): Run {
  const worker = new Worker(new URL("./speed-test.worker.ts", import.meta.url), {
    type: "module",
  });
  let settle: (outcome: RunOutcome) => void = () => undefined;
  const outcome = new Promise<RunOutcome>((resolve) => {
    settle = resolve;
  });
  let ended = false;

  function end(result: RunOutcome): void {
    if (ended) return;
    ended = true;
    worker.terminate();
    settle(result);
  }

  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    if (ended) return;
    const message = event.data;
    if (message.type === "progress") {
      onProgress(message.event);
    } else if (message.outcome.status === "complete") {
      end({ status: "complete", result: message.outcome.result });
    } else {
      end({ status: "error", error: message.outcome.error });
    }
  });
  worker.addEventListener("error", () => {
    end({ status: "crashed" });
  });

  const command: StartCommand = { lowData };
  worker.postMessage(command);

  return {
    outcome,
    stop(reason) {
      end({ status: "stopped", reason });
    },
  };
}
