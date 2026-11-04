import { ADDRESS_LIMITS, limitContext, withinAddressLimit } from "./address-limits";
import { clientIp } from "./client-ip";
import { getStores } from "./stores";

/*
 * The one piece of server code the share-card image route may import (eslint.config.ts): each
 * render costs real CPU, and a script can mint endless valid codes. CDN hits never reach here, so
 * only fresh renders count. Fails open, like every per-address limit, and with no stores or no
 * CLIENT_IP_HEADER there is no limit at all.
 */
export async function cardRenderAllowed(request: Request): Promise<boolean> {
  const stores = await getStores();
  const ip = clientIp(request.headers, process.env.CLIENT_IP_HEADER);
  return withinAddressLimit(
    limitContext(stores, ip, Date.now()),
    "cards",
    ADDRESS_LIMITS.cardsPerMinute,
    "minute",
  );
}
