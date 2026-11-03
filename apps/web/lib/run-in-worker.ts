import type { EngineError, EngineResult, ProgressEvent } from "@kilomita/engine";
import type { StartCommand, WorkerReply } from "./speed-test.worker";

/**
 * "unmount": the page is going away, so nobody is left to tell. "offline": the browser lost its
 * connection mid-run.
 */
export type StopReason = "user" | "hidden" | "unmount" | "offline";

export type RunOutcome =
  | { status: "complete"; result: EngineResult }
  | { status: "error"; error: EngineError }
  | { status: "stopped"; reason: StopReason }
  /**
   * The Worker failed. `loaded: false` means its script never ran, which after a deploy usually
   * means a cached page asked for a build's file that no longer exists.
   */
  | { status: "crashed"; loaded: boolean };

export interface Run {
  readonly outcome: Promise<RunOutcome>;
  /** Ends the run at once: the Worker is terminated, which also aborts its requests. */
  stop(reason: StopReason): void;
}

type WorkerLike = Pick<Worker, "addEventListener" | "postMessage" | "terminate">;

const createWorker = (): WorkerLike =>
  new Worker(new URL("./speed-test.worker.ts", import.meta.url), { type: "module" });

/** One Worker per run, created here and terminated when the run ends, however it ends. */
export function startRun(
  command: StartCommand,
  onProgress: (event: ProgressEvent) => void,
  spawn: () => WorkerLike = createWorker,
): Run {
  const worker = spawn();
  let settle: (outcome: RunOutcome) => void = () => undefined;
  const outcome = new Promise<RunOutcome>((resolve) => {
    settle = resolve;
  });
  let ended = false;
  let loaded = false;

  function end(result: RunOutcome): void {
    if (ended) return;
    ended = true;
    worker.terminate();
    settle(result);
  }

  worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
    if (ended) return;
    const message = event.data;
    if (message.type === "ready") {
      loaded = true;
    } else if (message.type === "progress") {
      onProgress(message.event);
    } else if (message.outcome.status === "complete") {
      end({ status: "complete", result: message.outcome.result });
    } else {
      end({ status: "error", error: message.outcome.error });
    }
  });
  worker.addEventListener("error", () => {
    end({ status: "crashed", loaded });
  });

  worker.postMessage(command);

  return {
    outcome,
    stop(reason) {
      end({ status: "stopped", reason });
    },
  };
}
