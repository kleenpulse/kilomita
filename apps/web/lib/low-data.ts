const STORAGE_KEY = "kilomita.lowData";

type Listener = () => void;
const listeners = new Set<Listener>();
/** The latest choice when storage refused it, so this page keeps it until reload. */
let unsaved: boolean | null = null;

/** A stored choice, or null when there is none (or it is garbage). */
export function parseStored(value: string | null): boolean | null {
  if (value === "on") return true;
  if (value === "off") return false;
  return null;
}

/** The user's own choice wins; without one, follow the browser's Data Saver. */
export function resolveLowData(stored: string | null, saveData: boolean): boolean {
  return parseStored(stored) ?? saveData;
}

function browserSaveData(): boolean {
  // navigator.connection (Network Information API) is not in lib.dom.
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } };
  return connection?.saveData === true;
}

/** Reads the setting. Storage can be missing or throw (private mode, blocked site data). */
export function readLowData(
  getStorage: () => Pick<Storage, "getItem"> = () => window.localStorage,
  saveData: () => boolean = browserSaveData,
): boolean {
  if (unsaved !== null) return unsaved;
  let stored: string | null = null;
  try {
    stored = getStorage().getItem(STORAGE_KEY);
  } catch {
    // Fall back to the default.
  }
  return resolveLowData(stored, saveData());
}

export function writeLowData(
  on: boolean,
  getStorage: () => Pick<Storage, "setItem"> = () => window.localStorage,
): void {
  try {
    getStorage().setItem(STORAGE_KEY, on ? "on" : "off");
    unsaved = null;
  } catch {
    unsaved = on;
  }
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore: changes from this tab and from other tabs. */
export function subscribeLowData(listener: Listener): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
