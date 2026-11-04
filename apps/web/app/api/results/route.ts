import { connection } from "next/server";
import { guarded } from "@/server/http";
import { handleDelete, handleSubmit } from "@/server/results-route";
import { countFailure } from "@/server/route-metrics";
import { sharingDeps } from "@/server/stores";

export async function POST(request: Request) {
  await connection();
  return guarded(
    "results-submit",
    async () => handleSubmit(request, await sharingDeps()),
    countFailure,
  );
}

export async function DELETE(request: Request) {
  await connection();
  return guarded(
    "results-delete",
    async () => handleDelete(request, await sharingDeps()),
    countFailure,
  );
}
