import { SHARING } from "@kilomita/shared/lists";

/**
 * The secrets of results shared from this browser (localStorage "kilomita.shared"): the only proof
 * of ownership, since there are no accounts. An entry is written before its result is sent, with
 * no id yet, so a result stored behind a lost response can still be deleted. Clearing site data
 * loses them, and with them the way to delete those results; the privacy page says so.
 */
export interface SharedEntry {
  id: string | null;
  secret: string;
  /** When it was shared, on this device's clock. */
  at: number;
}

const KEY = "kilomita.shared";
type GetStorage = () => Pick<Storage, "getItem" | "setItem">;
const browserStorage: GetStorage = () => window.localStorage;

/** Kept when storage refuses a write (private mode, blocked site data), until reload. */
let unsaved: SharedEntry[] | null = null;

function isEntry(value: unknown): value is SharedEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    (entry.id === null || typeof entry.id === "string") &&
    typeof entry.secret === "string" &&
    typeof entry.at === "number"
  );
}

/** The live entries, newest last; anything past retention is gone from the server too. */
export function readShared(now: number, getStorage: GetStorage = browserStorage): SharedEntry[] {
  let entries: SharedEntry[] = unsaved ?? [];
  if (unsaved === null) {
    try {
      const parsed: unknown = JSON.parse(getStorage().getItem(KEY) ?? "[]");
      entries = Array.isArray(parsed) ? parsed.filter(isEntry) : [];
    } catch {
      entries = [];
    }
  }
  return entries.filter((entry) => now - entry.at < SHARING.retentionMs);
}

function write(entries: SharedEntry[], getStorage: GetStorage): void {
  try {
    getStorage().setItem(KEY, JSON.stringify(entries));
    unsaved = null;
  } catch {
    unsaved = entries;
  }
}

export function addPending(secret: string, now: number, getStorage = browserStorage): void {
  write([...readShared(now, getStorage), { id: null, secret, at: now }], getStorage);
}

export function setSharedId(
  secret: string,
  id: string,
  now: number,
  getStorage = browserStorage,
): void {
  const entries = readShared(now, getStorage);
  write(
    entries.map((entry) => (entry.secret === secret ? { ...entry, id } : entry)),
    getStorage,
  );
}

export function forget(secrets: readonly string[], now: number, getStorage = browserStorage): void {
  const gone = new Set(secrets);
  write(
    readShared(now, getStorage).filter((entry) => !gone.has(entry.secret)),
    getStorage,
  );
}

/** A result's secret: 32 random bytes, base64url without padding (43 characters). */
export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** For tests: drop the in-memory fallback. */
export function resetSharedMemory(): void {
  unsaved = null;
}
