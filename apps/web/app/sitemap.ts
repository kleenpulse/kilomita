import { ISPS, NIGERIAN_STATES } from "@kilomita/shared/lists";
import type { MetadataRoute } from "next";
import { SITE_URL } from "./_components/site-url";

/** From the lists alone: the build never touches a database. "Other" has no page. */
export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [
    "/",
    "/isps",
    ...ISPS.filter((isp) => isp.slug !== "other").map((isp) => `/isps/${isp.slug}`),
    "/states",
    ...NIGERIAN_STATES.map((state) => `/states/${state.slug}`),
    "/methodology",
    "/privacy",
  ];
  return paths.map((path) => ({ url: `${SITE_URL}${path}` }));
}
