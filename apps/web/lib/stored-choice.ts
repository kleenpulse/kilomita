type Listener = () => void;
type GetStorage<K extends keyof Storage> = () => Pick<Storage, K>;

/**
 * A choice kept in localStorage under one key. Storage can be missing or throw (private mode,
 * blocked site data): reads then fall back to null, and a refused write is kept in memory so this
 * page holds the choice until reload.
 */
export function storedChoice<T extends string>(key: string, values: readonly T[]) {
  const listeners = new Set<Listener>();
  let unsaved: T | null = null;

  /** A stored value, or null when there is none (or it is garbage). */
  function parse(value: string | null): T | null {
    return values.find((candidate) => candidate === value) ?? null;
  }

  return {
    key,
    parse,

    read: (getStorage: GetStorage<"getItem"> = () => window.localStorage): T | null => {
      if (unsaved !== null) return unsaved;
      try {
        return parse(getStorage().getItem(key));
      } catch {
        return null;
      }
    },

    write: (value: T, getStorage: GetStorage<"setItem"> = () => window.localStorage): void => {
      try {
        getStorage().setItem(key, value);
        unsaved = null;
      } catch {
        unsaved = value;
      }
      for (const listener of listeners) listener();
    },

    /** For useSyncExternalStore: changes from this tab and from other tabs. */
    subscribe: (listener: Listener): (() => void) => {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
  };
}
