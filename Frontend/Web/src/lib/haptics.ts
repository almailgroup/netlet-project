/**
 * A short buzz under the finger, where the phone lets a page have one.
 *
 * Android's Chrome does (`navigator.vibrate`); Safari on an iPhone lets no page
 * vibrate at all, which is why the app carries its own haptics and the website
 * cannot. Called only from a press, since a browser refuses a buzz nobody
 * asked for, and never allowed to throw: a phone that will not buzz is a phone
 * that says nothing, not a press that fails.
 */
function buzz(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    /* A refused buzz is no buzz. */
  }
}

/** A press that changed something: adding, a step of the quantity, removing. */
export function pressHaptic(): void {
  buzz(10);
}

/** A press the shop refused — two short knocks, so it does not feel like the one that worked. */
export function refusedHaptic(): void {
  buzz([14, 70, 14]);
}
