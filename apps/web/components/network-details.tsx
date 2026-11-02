import type { IspSlug, NetworkTypeSlug, NigerianStateSlug } from "@kilomita/shared";
import { ISPS, NETWORK_TYPES, NIGERIAN_STATES } from "@kilomita/shared/lists";
import { CONNECTION_HINT, type ConnectionKind } from "@/lib/connection-hint";
import type { Detection } from "@/lib/detection";
import { networkNote } from "@/lib/network-note";

export interface NetworkSelection {
  isp: IspSlug | null;
  state: NigerianStateSlug | null;
  type: NetworkTypeSlug;
}

const TYPE_LABEL: Record<NetworkTypeSlug, string> = {
  unknown: "Not sure",
  "2g": "2G",
  "3g": "3G",
  "4g": "4G",
  "5g": "5G",
  fiber: "Fibre",
  "fixed-wireless": "Fixed wireless",
  satellite: "Satellite",
};

const TYPE_ORDER: readonly NetworkTypeSlug[] = [
  "unknown",
  ...NETWORK_TYPES.filter((type) => type !== "unknown"),
];

const SELECT =
  "h-11 w-full min-w-0 truncate rounded-lg border border-neutral-300 bg-white px-2 text-base text-neutral-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
const FIELD = "flex min-w-0 flex-col gap-1 text-sm font-medium";

interface Props {
  detection: Detection | "pending" | null;
  selection: NetworkSelection;
  hint: ConnectionKind | null;
  onChange: (change: Partial<NetworkSelection>) => void;
}

export function NetworkDetails({ detection, selection, hint, onChange }: Props) {
  const note = networkNote(detection);
  const hintText = hint ? CONNECTION_HINT[hint] : "";
  return (
    <section aria-labelledby="network-heading" className="text-left">
      <h2 id="network-heading" className="text-base font-semibold">
        Your network
      </h2>
      {/* Room for the longest note (Tizeti/Wifi.ng in the FCT) at 320 px. Keyed, so new text is a
          new node rather than a re-centred one. */}
      <p
        data-testid="network-note"
        className="mt-1 min-h-15 text-sm text-neutral-700 dark:text-neutral-300"
      >
        <span key={note}>{note}</span>
      </p>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-3">
        <div className={FIELD}>
          <label htmlFor="network-isp">Network</label>
          <select
            id="network-isp"
            className={SELECT}
            value={selection.isp ?? ""}
            onChange={(event) => {
              onChange({ isp: ISPS.find((isp) => isp.slug === event.target.value)?.slug ?? null });
            }}
          >
            <option value="">Choose…</option>
            {ISPS.map((isp) => (
              <option key={isp.slug} value={isp.slug}>
                {isp.name}
              </option>
            ))}
          </select>
        </div>
        <div className={FIELD}>
          <label htmlFor="network-state">State</label>
          <select
            id="network-state"
            className={SELECT}
            value={selection.state ?? ""}
            onChange={(event) => {
              onChange({
                state:
                  NIGERIAN_STATES.find((state) => state.slug === event.target.value)?.slug ?? null,
              });
            }}
          >
            <option value="">Choose…</option>
            {NIGERIAN_STATES.map((state) => (
              <option key={state.slug} value={state.slug}>
                {state.name}
              </option>
            ))}
          </select>
        </div>
        <div className={`${FIELD} col-span-2`}>
          <label htmlFor="network-type">Connection</label>
          <select
            id="network-type"
            className={SELECT}
            value={selection.type}
            aria-describedby="connection-hint"
            onChange={(event) => {
              onChange({
                type: NETWORK_TYPES.find((type) => type === event.target.value) ?? "unknown",
              });
            }}
          >
            {TYPE_ORDER.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {/* Room for the Wi-Fi hint, the longest, at 320 px. */}
      <p
        id="connection-hint"
        data-testid="connection-hint"
        className="mt-1 min-h-10 text-sm text-neutral-600 dark:text-neutral-400"
      >
        <span key={hintText}>{hintText}</span>
      </p>
    </section>
  );
}
