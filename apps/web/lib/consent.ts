import { storedChoice } from "./stored-choice";

export type Consent = "granted" | "declined" | "unasked";
export type ConsentChoice = Exclude<Consent, "unasked">;

const choice = storedChoice("kilomita.consent", ["granted", "declined"] as const);

/** The user's sharing choice on this device; "unasked" until they make one. */
export function readConsent(
  getStorage: () => Pick<Storage, "getItem"> = () => window.localStorage,
): Consent {
  return choice.read(getStorage) ?? "unasked";
}

export function writeConsent(
  value: ConsentChoice,
  getStorage: () => Pick<Storage, "setItem"> = () => window.localStorage,
): void {
  choice.write(value, getStorage);
}

export const subscribeConsent = choice.subscribe;

/**
 * The NDPA gate: every way a result leaves the device (Phase 4's submit) must pass it first.
 *
 * Granting shares the result on screen (once) and every later one. "unasked" and "declined" share
 * nothing. Revoking stops future sharing; removing results already shared is the delete path.
 */
export function mayShare(consent: Consent): boolean {
  return consent === "granted";
}
