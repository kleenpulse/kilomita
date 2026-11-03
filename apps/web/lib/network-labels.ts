import type { NetworkTypeSlug } from "@kilomita/shared";
import { NETWORK_TYPES } from "@kilomita/shared/lists";

export const TYPE_LABEL: Record<NetworkTypeSlug, string> = {
  unknown: "Not sure",
  "2g": "2G",
  "3g": "3G",
  "4g": "4G",
  "5g": "5G",
  fiber: "Fibre",
  "fixed-wireless": "Fixed wireless",
  satellite: "Satellite",
};

/** "Not sure" first: it is the selector's default. */
export const TYPE_ORDER: readonly NetworkTypeSlug[] = [
  "unknown",
  ...NETWORK_TYPES.filter((type) => type !== "unknown"),
];
