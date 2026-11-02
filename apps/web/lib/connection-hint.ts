export type ConnectionKind = "cellular" | "wifi" | "ethernet";

/*
 * navigator.connection.type exists only in Chromium on Android and ChromeOS. It says what the
 * device is attached to, never which G or what is behind the Wi-Fi, so it only hints at the
 * choice. effectiveType is not used: it is a speed estimate from round-trip time and downlink.
 */
export const CONNECTION_HINT: Record<ConnectionKind, string> = {
  cellular: "Your device says mobile data.",
  wifi: "Your device says Wi-Fi. If that's a MiFi or hotspot, pick its mobile type.",
  ethernet: "Your device says a cable connection.",
};

export function connectionKind(type: unknown): ConnectionKind | null {
  return type === "cellular" || type === "wifi" || type === "ethernet" ? type : null;
}

export function readConnectionKind(): ConnectionKind | null {
  // navigator.connection (Network Information API) is not in lib.dom.
  const { connection } = navigator as Navigator & { connection?: { type?: unknown } };
  return connectionKind(connection?.type);
}
