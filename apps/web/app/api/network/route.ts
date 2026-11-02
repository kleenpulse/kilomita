import { connection } from "next/server";
import { activeProvider } from "@/server/ip-provider";
import { handleNetworkRequest } from "@/server/network-route";

export async function GET(request: Request) {
  // Always request-time, even if Cache Components is switched on later.
  await connection();
  return handleNetworkRequest(request, activeProvider, process.env.CLIENT_IP_HEADER);
}
