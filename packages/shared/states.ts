export const GEOPOLITICAL_ZONES = [
  "north-central",
  "north-east",
  "north-west",
  "south-east",
  "south-south",
  "south-west",
] as const;

export type GeopoliticalZone = (typeof GEOPOLITICAL_ZONES)[number];

export const NIGERIAN_STATES = [
  { slug: "abia", name: "Abia", zone: "south-east" },
  { slug: "adamawa", name: "Adamawa", zone: "north-east" },
  { slug: "akwa-ibom", name: "Akwa Ibom", zone: "south-south" },
  { slug: "anambra", name: "Anambra", zone: "south-east" },
  { slug: "bauchi", name: "Bauchi", zone: "north-east" },
  { slug: "bayelsa", name: "Bayelsa", zone: "south-south" },
  { slug: "benue", name: "Benue", zone: "north-central" },
  { slug: "borno", name: "Borno", zone: "north-east" },
  { slug: "cross-river", name: "Cross River", zone: "south-south" },
  { slug: "delta", name: "Delta", zone: "south-south" },
  { slug: "ebonyi", name: "Ebonyi", zone: "south-east" },
  { slug: "edo", name: "Edo", zone: "south-south" },
  { slug: "ekiti", name: "Ekiti", zone: "south-west" },
  { slug: "enugu", name: "Enugu", zone: "south-east" },
  { slug: "fct", name: "Federal Capital Territory", zone: "north-central" },
  { slug: "gombe", name: "Gombe", zone: "north-east" },
  { slug: "imo", name: "Imo", zone: "south-east" },
  { slug: "jigawa", name: "Jigawa", zone: "north-west" },
  { slug: "kaduna", name: "Kaduna", zone: "north-west" },
  { slug: "kano", name: "Kano", zone: "north-west" },
  { slug: "katsina", name: "Katsina", zone: "north-west" },
  { slug: "kebbi", name: "Kebbi", zone: "north-west" },
  { slug: "kogi", name: "Kogi", zone: "north-central" },
  { slug: "kwara", name: "Kwara", zone: "north-central" },
  { slug: "lagos", name: "Lagos", zone: "south-west" },
  { slug: "nasarawa", name: "Nasarawa", zone: "north-central" },
  { slug: "niger", name: "Niger", zone: "north-central" },
  { slug: "ogun", name: "Ogun", zone: "south-west" },
  { slug: "ondo", name: "Ondo", zone: "south-west" },
  { slug: "osun", name: "Osun", zone: "south-west" },
  { slug: "oyo", name: "Oyo", zone: "south-west" },
  { slug: "plateau", name: "Plateau", zone: "north-central" },
  { slug: "rivers", name: "Rivers", zone: "south-south" },
  { slug: "sokoto", name: "Sokoto", zone: "north-west" },
  { slug: "taraba", name: "Taraba", zone: "north-east" },
  { slug: "yobe", name: "Yobe", zone: "north-east" },
  { slug: "zamfara", name: "Zamfara", zone: "north-west" },
] as const satisfies readonly { slug: string; name: string; zone: GeopoliticalZone }[];

export type NigerianStateSlug = (typeof NIGERIAN_STATES)[number]["slug"];

export const STATE_SLUGS = NIGERIAN_STATES.map((state) => state.slug) as [
  NigerianStateSlug,
  ...NigerianStateSlug[],
];
