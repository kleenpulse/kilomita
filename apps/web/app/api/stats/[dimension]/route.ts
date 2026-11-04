import { connection } from "next/server";
import { guarded } from "@/server/http";
import { countFailure } from "@/server/route-metrics";
import { handleStats } from "@/server/stats-route";
import { sharingDeps } from "@/server/stores";

export async function GET(request: Request, context: RouteContext<"/api/stats/[dimension]">) {
  await connection();
  const { dimension } = await context.params;
  return guarded(
    "stats",
    async () => handleStats(new URL(request.url), dimension, await sharingDeps()),
    countFailure,
  );
}
