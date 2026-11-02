import { isIP } from "node:net";

/** The eight 16-bit groups of a valid IPv6 address, each as 4 hex digits. */
export function expandIpv6(ip: string): string[] {
  let address = ip.toLowerCase();
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    const tail = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    address = address.slice(0, dotted.index) + tail;
  }
  const [head = "", rest] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = rest ? rest.split(":") : [];
  const groups =
    rest === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return groups.map((group) => Number.parseInt(group, 16).toString(16).padStart(4, "0"));
}

/**
 * A canonical address: IPv4 as is, IPv4-mapped IPv6 (any spelling) as IPv4, other IPv6 in lower
 * case. Null for anything else, including ports, brackets and zone IDs.
 */
export function normaliseIp(raw: string): string | null {
  const ip = raw.trim();
  const version = isIP(ip);
  if (version === 4) return ip;
  if (version !== 6 || ip.includes("%")) return null;
  const groups = expandIpv6(ip);
  if (groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff") {
    const high = Number.parseInt(groups[6] ?? "0", 16);
    const low = Number.parseInt(groups[7] ?? "0", 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return ip.toLowerCase();
}
