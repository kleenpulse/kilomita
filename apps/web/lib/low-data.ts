import { storedChoice } from "./stored-choice";

const choice = storedChoice("kilomita.lowData", ["on", "off"] as const);

/** A stored choice, or null when there is none (or it is garbage). */
export function parseStored(value: string | null): boolean | null {
  const stored = choice.parse(value);
  return stored === null ? null : stored === "on";
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
  return resolveLowData(choice.read(getStorage), saveData());
}

export function writeLowData(
  on: boolean,
  getStorage: () => Pick<Storage, "setItem"> = () => window.localStorage,
): void {
  choice.write(on ? "on" : "off", getStorage);
}

export const subscribeLowData = choice.subscribe;
