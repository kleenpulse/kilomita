import { connection } from "next/server";
import { guarded } from "@/server/http";
import { testServerSetup, ticketGuard } from "@/server/test-servers";
import { handleTestServers } from "@/server/test-servers-route";

export async function POST(request: Request) {
  await connection();
  return guarded(() =>
    handleTestServers(request, { ...testServerSetup(), guard: ticketGuard(), now: Date.now }),
  );
}
