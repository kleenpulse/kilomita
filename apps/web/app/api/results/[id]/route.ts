import { connection } from "next/server";
import { guarded } from "@/server/http";
import { handleCorrect } from "@/server/results-route";
import { countFailure } from "@/server/route-metrics";
import { sharingDeps } from "@/server/stores";

export async function PATCH(request: Request, context: RouteContext<"/api/results/[id]">) {
  await connection();
  const { id } = await context.params;
  return guarded(
    "results-correct",
    async () => handleCorrect(request, id, await sharingDeps()),
    countFailure,
  );
}
