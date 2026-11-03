import type { MetadataRoute } from "next";
import { SITE_URL } from "./_components/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    // The stats API is the Dataset markup's download; the other routes are for the app only.
    rules: { userAgent: "*", allow: ["/", "/api/stats/"], disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
