import { SERVICE_WORKER_SOURCE } from "@/lib/service-worker-source";

export const dynamic = "force-static";

export function GET() {
  return new Response(SERVICE_WORKER_SOURCE, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      // Checked on every load, so a new version reaches the installed app promptly.
      "cache-control": "no-cache",
    },
  });
}
