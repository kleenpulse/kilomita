import type { NigerianStateSlug } from "@kilomita/shared";

/** What a provider knows about an IP. Each adapter maps its own region format to a state slug. */
export interface IpLookup {
  asn: number | null;
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string | null;
  stateSlug: NigerianStateSlug | null;
}

export interface IpProvider {
  readonly id: string;
  /** Null when the provider has no answer. May reject; callers treat that as no answer. */
  lookup(ip: string, signal: AbortSignal): Promise<IpLookup | null>;
}

/** No provider is chosen yet (see CLAUDE.md), so nothing is detected. */
export const noneProvider: IpProvider = {
  id: "none",
  lookup: () => Promise.resolve(null),
};

export const activeProvider: IpProvider = noneProvider;
