import { connection } from "next/server";
import { guarded } from "@/server/http";
import { handleCronPurge } from "@/server/ops-routes";
import { countFailure } from "@/server/route-metrics";
import { getStores } from "@/server/stores";

export async function GET(request: Request) {
  await connection();
  return guarded(
    "cron-purge",
    async () => handleCronPurge(request, await getStores(), process.env.CRON_SECRET, Date.now()),
    countFailure,
  );
}
