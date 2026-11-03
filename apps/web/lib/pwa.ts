/*
 * Loaded with import() once the page is idle, so it isn't in the home page's first download.
 * Scope "/?": only the installed app's start URL (/?source=pwa) is controlled, never the test's
 * Worker (see lib/service-worker-source.ts).
 */
export function registerServiceWorker(container: ServiceWorkerContainer | undefined): void {
  if (!container) return;
  void container.register("/sw.js", { scope: "/?", updateViaCache: "none" }).catch(() => undefined);
}
