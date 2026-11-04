import { connection } from "next/server";
import { guarded } from "@/server/http";
import { handleOutcome } from "@/server/outcomes-route";
import { countFailure, routeRecorder } from "@/server/route-metrics";
import { sharingDeps } from "@/server/stores";

export async function POST(request: Request) {
  await connection();
  return guarded(
    "outcomes",
    async () => {
      const deps = await sharingDeps();
      return handleOutcome(request, {
        stores: deps.stores,
        trustedHeader: deps.trustedHeader,
        knownServers: deps.knownServers,
        record: await routeRecorder(),
        now: deps.now,
      });
    },
    countFailure,
  );
}
