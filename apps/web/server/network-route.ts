import { clientIp } from "./client-ip";
import { detectNetwork } from "./detect";
import type { IpProvider } from "./ip-provider";

/** GET /api/network: the detected ISP and state. The IP itself is never logged or returned. */
export async function handleNetworkRequest(
  request: Request,
  provider: IpProvider,
  trustedHeader: string | undefined,
): Promise<Response> {
  const detection = await detectNetwork(clientIp(request.headers, trustedHeader), provider);
  return Response.json(detection, { headers: { "cache-control": "no-store" } });
}
