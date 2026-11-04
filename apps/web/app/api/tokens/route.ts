import { after, connection } from "next/server";
import { guarded } from "@/server/http";
import { countFailure, routeRecorder } from "@/server/route-metrics";
import { sharingDeps } from "@/server/stores";
import { handleTokenRequest } from "@/server/tokens-route";

export async function POST(request: Request) {
  await connection();
  return guarded(
    "tokens",
    async () =>
      handleTokenRequest(
        request,
        await sharingDeps(),
        (task) => {
          after(task);
        },
        await routeRecorder(),
      ),
    countFailure,
  );
}
