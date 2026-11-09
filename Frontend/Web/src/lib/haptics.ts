/**
 * A short buzz under the finger, where the phone lets a page have one.
 *
 * Android's Chrome does (`navigator.vibrate`); Safari on an iPhone lets no page
 * vibrate at all, which is why the app carries its own haptics and the website
 * cannot. Called only from a press, since a browser refuses a buzz nobody
 * asked for, and never allowed to throw: a phone that will not buzz is a phone
 * that says nothing, not a press that fails.
 */
import { readStored, removeStored, writeStored } from "@/lib/browserStore";

/*
 * **A shopper can turn every buzz off, on the owner's word** ("fully disable
 * haptic feedback for the application"): one switch in Preferences, kept on
 * this device (`netlet:haptics`, "off" while off), read by `buzz` itself so
 * no press anywhere can go round it. The app keeps its own (`Haptics.enabled`).
 */
const HAPTICS_KEY = "netlet:haptics";

/** Whether the browser has the call at all. */
function hasVibrate(): boolean {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

/**
 * Whether a buzz can be felt here — the switch is drawn only where it can.
 * A computer's Chrome has the call and nothing to buzz, so a touch screen is
 * asked for too: an Android phone.
 */
export function canBuzz(): boolean {
  return hasVibrate() && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/** Whether the shopper has left the buzz on. */
export function hapticsOn(): boolean {
  return readStored(HAPTICS_KEY) !== "off";
}

export function setHapticsOn(on: boolean): void {
  if (on) removeStored(HAPTICS_KEY);
  else writeStored(HAPTICS_KEY, "off");
}

function buzz(pattern: number | number[]): void {
  if (!hapticsOn()) return;
  try {
    if (hasVibrate()) navigator.vibrate(pattern);
  } catch {
    /* A refused buzz is no buzz. */
  }
}

/** A press that changed something: adding, a step of the quantity, removing. */
export function pressHaptic(): void {
  buzz(10);
}

/** Something done that matters — an order placed: a knock and a firmer one, apart. */
export function successHaptic(): void {
  buzz([12, 60, 24]);
}

/** A press the shop refused — two short knocks, so it does not feel like the one that worked. */
export function refusedHaptic(): void {
  buzz([14, 70, 14]);
}

/**
 * The map pin dropping into place once the map stops (on the owner's word, at
 * three quarters strength). A page's buzz has a length and no strength, so
 * the length stands in for it: half again a press's, as the app's 0.75 is to
 * its 0.5. It follows a drag of the map, which is the press a browser asks for.
 */
export function pinDropHaptic(): void {
  buzz(15);
}
