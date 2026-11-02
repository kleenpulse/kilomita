import { type IspSlug, type NigerianStateSlug, ispForAsn } from "@kilomita/shared";
import type { IpProvider } from "./ip-provider";

export interface Detection {
  isp: IspSlug | null;
  state: NigerianStateSlug | null;
}

const NOTHING: Detection = { isp: null, state: null };

/** Never throws: no IP, no answer, a provider error or a timeout all mean nothing detected. */
export async function detectNetwork(
  ip: string | null,
  provider: IpProvider,
  timeoutMs = 1500,
): Promise<Detection> {
  if (ip === null) return NOTHING;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  try {
    const lookup = await Promise.race([provider.lookup(ip, controller.signal), timeout]);
    if (!lookup) return NOTHING;
    return {
      isp: lookup.asn === null ? null : ispForAsn(lookup.asn),
      state: lookup.countryCode === "NG" ? lookup.stateSlug : null,
    };
  } catch {
    return NOTHING;
  } finally {
    clearTimeout(timer);
  }
}
