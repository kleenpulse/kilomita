import type { EngineResult } from "@kilomita/engine";
import type {
  CorrectResult,
  DeviceClass,
  IspSlug,
  NetworkTypeSlug,
  NigerianStateSlug,
  SpeedTestResult,
} from "@kilomita/shared";
import { type Consent, mayShare } from "./consent";
import type { HeldToken } from "./sharing-api";

/*
 * Whether and when the result on screen is shared. Pure, so every rule is unit-tested:
 * - Only while mayShare(consent): granting shares the result on screen and later ones; unasked
 *   and declined share nothing; revoking stops whatever hasn't been sent.
 * - Only once a network is chosen (there is no IP provider yet, so usually by the user).
 * - At most once per result. Afterwards, changes to the network details are corrections.
 */

/** What happened to the result on screen. */
export type ShareProgress =
  | { status: "not-sent" }
  | { status: "shared"; id: string; secret: string; sent: NetworkSelection }
  | { status: "failed" }
  | { status: "too-old" }
  | { status: "unavailable" };

export interface NetworkSelection {
  isp: IspSlug | null;
  state: NigerianStateSlug | null;
  type: NetworkTypeSlug;
}

export type ShareStatus =
  "waiting-isp" | "sending" | "shared" | "failed" | "too-old" | "unavailable";

export type ShareStep =
  | { kind: "send" }
  /** Nothing to do now; null when sharing is off, so the card shows the consent status. */
  | { kind: "show"; status: ShareStatus | null };

export function shareStep(input: {
  consent: Consent;
  progress: ShareProgress;
  token: HeldToken | null;
  isp: IspSlug | null;
  /** The token's time ran out (set by a timer, so rendering stays pure). */
  expired: boolean;
}): ShareStep {
  const { consent, progress, token, isp, expired } = input;
  // Whatever already happened to this result stays true, whatever the consent is now.
  if (progress.status !== "not-sent") return { kind: "show", status: progress.status };
  if (!mayShare(consent)) return { kind: "show", status: null };
  if (token === null) return { kind: "show", status: "unavailable" };
  if (expired) return { kind: "show", status: "too-old" };
  if (isp === null) return { kind: "show", status: "waiting-isp" };
  return { kind: "send" };
}

export const SHARE_TEXT: Record<ShareStatus, string> = {
  "waiting-isp": "Pick your network above to share this result.",
  sending: "Sharing…",
  shared: "Shared. Thank you!",
  failed: "Couldn't share this result.",
  "too-old": "This result is too old to share.",
  unavailable: "Sharing isn't available right now.",
};

/** The stored form: the engine's measurement plus the network details, nothing else. */
export function sharedResult(
  result: EngineResult,
  selection: NetworkSelection & { isp: IspSlug },
  device: DeviceClass,
): SpeedTestResult {
  return {
    downloadMbps: result.downloadMbps,
    uploadMbps: result.uploadMbps,
    latency: result.latency,
    loadedLatency: result.loadedLatency,
    bytesUsed: result.bytesUsed,
    durationMs: result.durationMs,
    lowDataMode: result.lowDataMode,
    engineVersion: result.engineVersion,
    serverId: result.serverId,
    measuredAt: result.measuredAt,
    ispSlug: selection.isp,
    ...(selection.state === null ? {} : { stateSlug: selection.state }),
    networkType: selection.type,
    deviceClass: device,
  };
}

/** The fields to correct after sharing, or null if nothing that can be corrected changed. */
export function correction(
  sent: NetworkSelection,
  now: NetworkSelection,
): Omit<CorrectResult, "secret"> | null {
  const change: Omit<CorrectResult, "secret"> = {};
  // A shared result keeps a network: clearing the selector isn't a correction.
  if (now.isp !== null && now.isp !== sent.isp) change.ispSlug = now.isp;
  if (now.state !== sent.state) change.stateSlug = now.state;
  if (now.type !== sent.type) change.networkType = now.type;
  return Object.keys(change).length === 0 ? null : change;
}

/** A token can be reused for the next run only if it was never sent, has time left, and fits. */
export function reusable(
  token: HeldToken | null,
  sent: boolean,
  lowData: boolean,
  now: number,
): token is HeldToken {
  const FIVE_MINUTES = 5 * 60_000;
  return (
    token !== null && !sent && token.lowData === lowData && token.expiresAt - now >= FIVE_MINUTES
  );
}
