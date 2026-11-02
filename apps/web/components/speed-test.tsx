"use client";

import type { EngineResult, Phase, ProgressEvent } from "@kilomita/engine";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type ConnectionKind, readConnectionKind } from "@/lib/connection-hint";
import { readConsent, subscribeConsent, writeConsent } from "@/lib/consent";
import { type Detection, fetchDetection } from "@/lib/detection";
import { formatMbps, formatMegabytes } from "@/lib/format";
import { readLowData, subscribeLowData, writeLowData } from "@/lib/low-data";
import { CRASHED_MESSAGE, LEFT_PAGE_MESSAGE, errorMessage } from "@/lib/messages";
import { type Run, type RunOutcome, startRun } from "@/lib/run-in-worker";
import { ConsentCard } from "./consent-card";
import { LowDataSwitch } from "./low-data-switch";
import { type NetworkSelection, NetworkDetails } from "./network-details";
import { PLACEHOLDER_RESULT, Reveal, ResultPanel } from "./result-panel";

type View =
  | { status: "idle" }
  | {
      status: "running";
      phase: Phase;
      download: number | null;
      upload: number | null;
      bytesUsed: number;
    }
  | { status: "complete"; result: EngineResult }
  | { status: "ended"; message: string; alert: boolean; bytesUsed: number };

const PHASE_TEXT: Record<Phase, string> = {
  latency: "Checking latency…",
  download: "Testing download…",
  upload: "Testing upload…",
};

function endedView(outcome: Exclude<RunOutcome, { status: "complete" }>, bytesUsed: number): View {
  switch (outcome.status) {
    case "stopped":
      return outcome.reason === "user"
        ? { status: "ended", message: "Test stopped.", alert: false, bytesUsed }
        : { status: "ended", message: LEFT_PAGE_MESSAGE, alert: true, bytesUsed };
    case "crashed":
      return { status: "ended", message: CRASHED_MESSAGE, alert: true, bytesUsed };
    case "error":
      return outcome.error.code === "cancelled"
        ? { status: "ended", message: "Test stopped.", alert: false, bytesUsed }
        : { status: "ended", message: errorMessage(outcome.error), alert: true, bytesUsed };
  }
}

function bigNumber(view: View): string {
  if (view.status === "complete") return formatMbps(view.result.downloadMbps);
  if (view.status === "running" && view.download !== null) return formatMbps(view.download);
  return "–";
}

function statusText(view: View): string {
  switch (view.status) {
    case "idle":
      return "Tap Start. E no go long.";
    case "running":
      return view.phase === "upload" && view.upload !== null
        ? `${PHASE_TEXT.upload} ${formatMbps(view.upload)} Mbps`
        : PHASE_TEXT[view.phase];
    case "complete":
      return "Your net don finish test!";
    case "ended":
      return view.alert ? "The test didn't finish." : "Test stopped.";
  }
}

/** What a screen reader hears: phase changes and the final numbers, never every tick. */
function announcement(view: View): string {
  switch (view.status) {
    case "idle":
      return "";
    case "running":
      return PHASE_TEXT[view.phase];
    case "complete": {
      const { result } = view;
      return `Test complete. Download ${formatMbps(result.downloadMbps)} Mbps, upload ${formatMbps(result.uploadMbps)} Mbps, latency ${String(Math.round(result.latency.idleMedianMs))} ms.`;
    }
    case "ended":
      // An alert announces itself; saying it here too would repeat it.
      return view.alert ? "" : view.message;
  }
}

export function SpeedTest() {
  const lowData = useSyncExternalStore(subscribeLowData, readLowData, () => false);
  const consent = useSyncExternalStore(subscribeConsent, readConsent, () => "unasked" as const);
  const [view, setView] = useState<View>({ status: "idle" });
  const [detection, setDetection] = useState<Detection | "pending" | null>(null);
  const [selection, setSelection] = useState<NetworkSelection>({
    isp: null,
    state: null,
    type: "unknown",
  });
  const [hint, setHint] = useState<ConnectionKind | null>(null);
  const edited = useRef({ isp: false, state: false });
  const run = useRef<Run | null>(null);
  /** The latest run started, so a late detection for an older run is dropped. */
  const lastRun = useRef<Run | null>(null);
  const bytesUsed = useRef(0);
  const running = view.status === "running";

  // Only after a finished run, so the request never competes with a measurement.
  const detect = useCallback((current: Run) => {
    setHint(readConnectionKind());
    setDetection("pending");
    void fetchDetection().then((found) => {
      if (run.current !== null || lastRun.current !== current) return;
      setDetection(found);
      setSelection((previous) => ({
        ...previous,
        isp: edited.current.isp ? previous.isp : found.isp,
        state: edited.current.state ? previous.state : found.state,
      }));
    });
  }, []);

  const onProgress = useCallback((event: ProgressEvent) => {
    bytesUsed.current = event.bytesUsed;
    setView((previous) => {
      if (previous.status !== "running") return previous;
      const live = event.currentMbps;
      return {
        status: "running",
        phase: event.phase,
        bytesUsed: event.bytesUsed,
        download: event.phase === "download" && live !== null ? live : previous.download,
        upload: event.phase === "upload" && live !== null ? live : previous.upload,
      };
    });
  }, []);

  const start = useCallback(() => {
    if (run.current) return;
    bytesUsed.current = 0;
    setView({ status: "running", phase: "latency", download: null, upload: null, bytesUsed: 0 });
    const current = startRun(lowData, onProgress);
    run.current = current;
    lastRun.current = current;
    void current.outcome.then((outcome) => {
      if (run.current !== current) return;
      run.current = null;
      if (outcome.status === "stopped" && outcome.reason === "unmount") return;
      if (outcome.status === "complete") {
        setView({ status: "complete", result: outcome.result });
        detect(current);
      } else {
        setView(endedView(outcome, bytesUsed.current));
      }
    });
  }, [lowData, onProgress, detect]);

  // Background pages get throttled, Worker included, so a reading taken there can't be trusted.
  useEffect(() => {
    if (!running) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") run.current?.stop("hidden");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [running]);

  // Leaving the page must not leave a run spending data.
  useEffect(
    () => () => {
      run.current?.stop("unmount");
    },
    [],
  );

  const ended = view.status === "ended" ? view : null;
  const complete = view.status === "complete";
  const status = statusText(view);
  const dataUsed = view.status === "running" ? `${formatMegabytes(view.bytesUsed)} used` : null;
  const buttonLabel = running ? "Stop" : view.status === "idle" ? "Start" : "Test again";

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center" aria-hidden="true">
        <span className="text-sm font-medium tracking-wide text-neutral-600 uppercase dark:text-neutral-400">
          Download
        </span>
        <span
          data-testid="download-speed"
          className="inline-block w-[4ch] text-center text-[clamp(4.5rem,24vw,8rem)] leading-none font-semibold tabular-nums"
        >
          {/* Keyed: a new text node each time, so re-centring the digits isn't a layout shift. */}
          <span key={bigNumber(view)}>{bigNumber(view)}</span>
        </span>
        <span className="text-xl text-neutral-600 dark:text-neutral-400">Mbps</span>
      </div>

      <p
        className="h-6 w-full text-center text-base text-neutral-700 tabular-nums dark:text-neutral-300"
        aria-hidden="true"
      >
        <span key={`${status} ${dataUsed ?? ""}`}>
          {status}
          {dataUsed ? (
            <span className="text-neutral-600 dark:text-neutral-400"> · {dataUsed}</span>
          ) : null}
        </span>
      </p>
      <p role="status" className="sr-only">
        {announcement(view)}
      </p>

      <button
        type="button"
        onClick={() => {
          if (run.current) run.current.stop("user");
          else start();
        }}
        className={`h-14 w-44 rounded-full text-lg font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 ${running ? "bg-neutral-800 hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300" : "bg-emerald-700 hover:bg-emerald-800"}`}
      >
        <span key={buttonLabel}>{buttonLabel}</span>
      </button>

      <LowDataSwitch
        checked={lowData}
        disabled={running}
        onChange={(checked) => {
          writeLowData(checked);
        }}
      />

      <div data-testid="result-area" className="relative mt-2 w-full">
        <ResultPanel result={complete ? view.result : PLACEHOLDER_RESULT} shown={complete} />
        <div aria-hidden={!complete}>
          <Reveal shown={complete} order={5} className="mt-8">
            <NetworkDetails
              detection={detection}
              selection={selection}
              hint={hint}
              onChange={(change) => {
                if ("isp" in change) edited.current.isp = true;
                if ("state" in change) edited.current.state = true;
                setSelection((previous) => ({ ...previous, ...change }));
              }}
            />
          </Reveal>
          <Reveal shown={complete} order={6} className="mt-6">
            <ConsentCard consent={consent} onChoose={writeConsent} />
          </Reveal>
        </div>
        {ended ? (
          <div
            role={ended.alert ? "alert" : undefined}
            className={`absolute inset-x-0 top-0 rounded-xl border p-4 text-left ${ended.alert ? "border-amber-600/40 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-950/40" : "border-neutral-300 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900"}`}
          >
            <p className="font-medium">{ended.message}</p>
            <p className="mt-1 text-sm text-neutral-700 tabular-nums dark:text-neutral-300">
              Data used before it stopped:{" "}
              {ended.bytesUsed > 0 ? `about ${formatMegabytes(ended.bytesUsed)}` : "none"}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
