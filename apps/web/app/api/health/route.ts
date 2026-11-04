import { connection } from "next/server";
import { guarded } from "@/server/http";
import { handleHealth } from "@/server/ops-routes";
import { getStores } from "@/server/stores";

export async function GET() {
  await connection();
  return guarded("health", async () => handleHealth(await getStores(), Date.now()));
}
