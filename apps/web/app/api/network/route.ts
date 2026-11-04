import { connection } from "next/server";
import { guarded } from "@/server/http";
import { activeProvider } from "@/server/ip-provider";
import { handleNetworkRequest } from "@/server/network-route";
import { countFailure } from "@/server/route-metrics";

export async function GET(request: Request) {
  // Always request-time, even if Cache Components is switched on later.
  await connection();
  return guarded(
    "network",
    () => handleNetworkRequest(request, activeProvider, process.env.CLIENT_IP_HEADER),
    countFailure,
  );
}
