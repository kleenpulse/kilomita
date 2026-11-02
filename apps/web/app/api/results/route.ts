import { connection } from "next/server";
import { guarded } from "@/server/http";
import { handleDelete, handleSubmit } from "@/server/results-route";
import { sharingDeps } from "@/server/stores";

export async function POST(request: Request) {
  await connection();
  return guarded(async () => handleSubmit(request, await sharingDeps()));
}

export async function DELETE(request: Request) {
  await connection();
  return guarded(async () => handleDelete(request, await sharingDeps()));
}
