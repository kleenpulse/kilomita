"use client";

import type { EngineResult, Phase, ProgressEvent } from "@kilomita/engine";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type ConnectionKind, readConnectionKind } from "@/lib/connection-hint";
import { readConsent, subscribeConsent, writeConsent } from "@/lib/consent";
import { type Detection, fetchDetection } from "@/lib/detection";
import { readDeviceClass } from "@/lib/device-class";
import { formatMbps, formatMegabytes } from "@/lib/format";
import { readLowData, subscribeLowData, writeLowData } from "@/lib/low-data";
import { CRASHED_MESSAGE, LEFT_PAGE_MESSAGE, errorMessage } from "@/lib/messages";
import { type Run, type RunOutcome, startRun } from "@/lib/run-in-worker";
import {
  type NetworkSelection,
  type ShareProgress,
  correction,
  reusable,
  shareStep,
  sharedResult,
} from "@/lib/share";
import { addPending, forget, newSecret, setSharedId } from "@/lib/shared-results";
import {
  type HeldToken,
  type SubmitOutcome,
  correctResult,
  requestToken,
  submitResult,
} from "@/lib/sharing-api";
import { ConsentCard } from "./consent-card";
import { LowDataSwitch } from "./low-data-switch";
import { NetworkDetails } from "./network-details";
import { PLACEHOLDER_RESULT, Reveal, ResultPanel } from "./result-panel";

type View =
  | { status: "idle" }
  /** Getting the test token, before any measurement traffic. */
  | { status: "starting" }
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

/** A retry after an unanswered send waits this long, then tries once more with the same secret. */
const RESEND_DELAY_MS = 2_000;
/** Corrections wait for the selectors to settle. */
const CORRECTION_DELAY_MS = 1_000;

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
    case "starting":
      return "Starting…";
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
    case "starting":
      return "Starting the test.";
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
  /** The token the result on screen was measured under, if one could be had. */
  const [runToken, setRunToken] = useState<HeldToken | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [share, setShare] = useState<ShareProgress>({ status: "not-sent" });
  const edited = useRef({ isp: false, state: false });
  const run = useRef<Run | null>(null);
  /** The latest run started, so a late detection for an older run is dropped. */
  const lastRun = useRef<Run | null>(null);
  const bytesUsed = useRef(0);
  /** Bumped by every Start and every Stop while starting: a stale token answer is dropped. */
  const attempt = useRef(0);
  /**
   * The latest token, and whether a POST carrying it was ever sent. A sent token counts as spent
   * whatever the answer: a lost response can hide a consumed token.
   */
  const latestToken = useRef<{ token: HeldToken | null; sent: boolean }>({
    token: null,
    sent: false,
  });
  /** The result a send was started for, so it is sent at most once. */
  const sentFor = useRef<EngineResult | null>(null);
  const running = view.status === "running";
  const busy = running || view.status === "starting";

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

  const measure = useCallback(
    (token: HeldToken | null) => {
      latestToken.current = { token, sent: false };
      setRunToken(token);
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
    },
    [lowData, onProgress, detect],
  );

  const start = useCallback(() => {
    if (run.current || view.status === "starting") return;
    bytesUsed.current = 0;
    setShare({ status: "not-sent" });
    setTokenExpired(false);
    setView({ status: "starting" });
    const mine = ++attempt.current;
    const { token, sent } = latestToken.current;
    // The token is in hand before the Worker starts, so asking never overlaps a measurement.
    const ready = reusable(token, sent, lowData, Date.now())
      ? Promise.resolve(token)
      : requestToken(lowData);
    void ready.then((held) => {
      if (attempt.current === mine) measure(held);
    });
  }, [view.status, lowData, measure]);

  const stop = useCallback(() => {
    if (run.current) {
      run.current.stop("user");
    } else if (view.status === "starting") {
      attempt.current++;
      setView({ status: "ended", message: "Test stopped.", alert: false, bytesUsed: 0 });
    }
  }, [view.status]);

  // Background pages get throttled, Worker included, so a reading taken there can't be trusted.
  useEffect(() => {
    if (!busy) return;
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      if (run.current) {
        run.current.stop("hidden");
      } else {
        attempt.current++;
        setView({ status: "ended", message: LEFT_PAGE_MESSAGE, alert: true, bytesUsed: 0 });
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [busy]);

  // Leaving the page must not leave a run spending data.
  useEffect(
    () => () => {
      run.current?.stop("unmount");
    },
    [],
  );

  // A token's time runs out while its result sits on screen.
  useEffect(() => {
    if (view.status !== "complete" || runToken === null) return;
    const timer = setTimeout(
      () => {
        setTokenExpired(true);
      },
      Math.max(0, runToken.expiresAt - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [view.status, runToken]);

  const complete = view.status === "complete" ? view : null;
  const step = complete
    ? shareStep({
        consent,
        progress: share,
        token: runToken,
        isp: selection.isp,
        expired: tokenExpired,
      })
    : null;

  // Sends the result on screen once mayShare(consent) holds and a network is chosen.
  const sendable = step?.kind === "send" && complete !== null && runToken !== null;
  useEffect(() => {
    if (!sendable || selection.isp === null || sentFor.current === complete.result) return;
    sentFor.current = complete.result;
    // Bumped the moment Test again is pressed, before the next run even has its token.
    const shown = attempt.current;
    const body = {
      token: runToken.value,
      secret: newSecret(),
      result: sharedResult(
        complete.result,
        { ...selection, isp: selection.isp },
        readDeviceClass(),
      ),
    };
    const sent = { ...selection };
    // Pending first: if the answer is lost, the secret still lets the user delete the result.
    addPending(body.secret, Date.now());
    if (latestToken.current.token === runToken) latestToken.current.sent = true;

    const settle = (outcome: SubmitOutcome, retried: boolean) => {
      if (outcome.status === "unknown" && !retried) {
        setTimeout(() => {
          void submitResult(body).then((again) => {
            settle(again, true);
          });
        }, RESEND_DELAY_MS);
        return;
      }
      if (outcome.status === "shared") setSharedId(body.secret, outcome.id, Date.now());
      // Refused means nothing was stored; unknown keeps the secret in case it was.
      if (outcome.status === "refused") forget([body.secret], Date.now());
      if (attempt.current !== shown) return;
      if (outcome.status === "shared") {
        setShare({ status: "shared", id: outcome.id, secret: body.secret, sent });
      } else if (outcome.status === "refused" && outcome.reason !== "refused") {
        setShare({ status: outcome.reason });
      } else {
        setShare({ status: "failed" });
      }
    };
    void submitResult(body).then((outcome) => {
      settle(outcome, false);
    });
    // Until the answer lands the step stays "send", which the card shows as "Sharing…".
  }, [sendable, complete, runToken, selection]);

  // After sharing, changes to the network details correct the stored result.
  const shared = share.status === "shared" ? share : null;
  useEffect(() => {
    if (!shared) return;
    const change = correction(shared.sent, selection);
    if (!change) return;
    const snapshot = { ...selection };
    const timer = setTimeout(() => {
      void correctResult(shared.id, { secret: shared.secret, ...change }).then((ok) => {
        if (!ok) return;
        setShare((current) =>
          current.status === "shared" && current.id === shared.id
            ? { ...current, sent: snapshot }
            : current,
        );
      });
    }, CORRECTION_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [shared, selection]);

  const ended = view.status === "ended" ? view : null;
  const status = statusText(view);
  const dataUsed = view.status === "running" ? `${formatMegabytes(view.bytesUsed)} used` : null;
  const buttonLabel = busy ? "Stop" : view.status === "idle" ? "Start" : "Test again";

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
        onClick={busy ? stop : start}
        className={`h-14 w-44 rounded-full text-lg font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 ${busy ? "bg-neutral-800 hover:bg-neutral-700 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-neutral-300" : "bg-emerald-700 hover:bg-emerald-800"}`}
      >
        <span key={buttonLabel}>{buttonLabel}</span>
      </button>

      <LowDataSwitch
        checked={lowData}
        disabled={busy}
        onChange={(checked) => {
          writeLowData(checked);
        }}
      />

      <div data-testid="result-area" className="relative mt-2 w-full">
        <ResultPanel result={complete ? complete.result : PLACEHOLDER_RESULT} shown={!!complete} />
        <div aria-hidden={!complete}>
          <Reveal shown={!!complete} order={5} className="mt-8">
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
          <Reveal shown={!!complete} order={6} className="mt-6">
            <ConsentCard
              consent={consent}
              shareStatus={step === null ? null : step.kind === "show" ? step.status : "sending"}
              onChoose={writeConsent}
            />
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
