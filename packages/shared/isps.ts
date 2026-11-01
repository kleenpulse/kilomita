export const ISPS = [
  { slug: "mtn", name: "MTN" },
  { slug: "airtel", name: "Airtel" },
  { slug: "glo", name: "Glo" },
  { slug: "9mobile", name: "9mobile" },
  { slug: "spectranet", name: "Spectranet" },
  { slug: "smile", name: "Smile" },
  { slug: "fibreone", name: "FibreOne" },
  { slug: "ipnx", name: "ipNX" },
  { slug: "tizeti", name: "Tizeti/Wifi.ng" },
  { slug: "starlink", name: "Starlink" },
  { slug: "other", name: "Other" },
] as const satisfies readonly { slug: string; name: string }[];

export type IspSlug = (typeof ISPS)[number]["slug"];

export const ISP_SLUGS = ISPS.map((isp) => isp.slug) as [IspSlug, ...IspSlug[]];
