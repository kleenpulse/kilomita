import { connection } from "next/server";
import { guarded } from "@/server/http";
import { countFailure, routeRecorder } from "@/server/route-metrics";
import { getStores } from "@/server/stores";
import { testServerSetup, ticketGuard } from "@/server/test-servers";
import { handleTestServers } from "@/server/test-servers-route";

export async function POST(request: Request) {
  await connection();
  return guarded(
    "test-servers",
    async () =>
      handleTestServers(request, {
        ...testServerSetup(),
        guard: ticketGuard(),
        now: Date.now,
        stores: await getStores(),
        trustedHeader: process.env.CLIENT_IP_HEADER,
        record: await routeRecorder(),
      }),
    countFailure,
  );
}
