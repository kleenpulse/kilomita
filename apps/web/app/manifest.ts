import type { MetadataRoute } from "next";
import { APP_NAME, DESCRIPTION } from "@kilomita/shared";

/*
 * start_url carries a query on purpose: the service worker's scope is "/?", so only launches of the
 * installed app are controlled. The speed test's Worker script, under /_next/static/, stays outside
 * that scope, so no service worker ever sits between the test and the network.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: DESCRIPTION,
    id: "/?source=pwa",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
