export const NETWORK_TYPES = [
  "2g",
  "3g",
  "4g",
  "5g",
  "fiber",
  "fixed-wireless",
  "satellite",
  "unknown",
] as const;

export type NetworkTypeSlug = (typeof NETWORK_TYPES)[number];
