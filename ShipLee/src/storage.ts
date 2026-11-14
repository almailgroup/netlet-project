/**
 * The device's own memory, for conveniences only (the language chosen). With
 * site data blocked the getter itself throws, so every read and write is
 * guarded: a failed read is nothing stored, a failed write is dropped.
 */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Nothing to do: the choice holds for this visit. */
  }
}
