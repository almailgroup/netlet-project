/**
 * An overlay that leaves rather than vanishes.
 *
 * Every drawer, dialog and menu here was drawn by `if (!open) return null`, so
 * it arrived and went in one frame — on a wide screen, where the bag drawer is
 * a third of the window, that cut is most of what made the shop feel abrupt.
 * This keeps the overlay drawn for `exitMs` after `open` turns false, with
 * `closing` true, so it can play its way out (`[data-closing]` in `index.css`).
 *
 * While closing it must be `inert` (the caller puts `inert={closing}` on its
 * outermost element): it takes no clicks, so the page behind answers at once,
 * and focus inside it counts as having left — `useOverlay` hands focus back to
 * the opener when the focused element sits inside an inert subtree, which is
 * what it would do had the overlay been unmounted.
 *
 * Somebody who asked for less motion gets the cut, as before: there is nothing
 * to wait for.
 */
import { useEffect, useRef, useState } from "react";

/** How long an overlay takes to leave, in step with `index.css`'s exits. */
export const EXIT_MS = 160;
/** The bag drawer slides a third of the window, so it takes a little longer. */
export const DRAWER_EXIT_MS = 220;
/** A menu hanging off a button is small and leaves quickly. */
export const MENU_EXIT_MS = 110;

function wantsLessMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function usePresence(open: boolean, exitMs: number = EXIT_MS): { mounted: boolean; closing: boolean } {
  const [shown, setShown] = useState(open);
  /* Opening is at once: no frame of an overlay that is open and not drawn. */
  if (open && !shown) setShown(true);
  /* Nothing to play: unmount in the same render, the old behaviour. */
  if (!open && shown && (exitMs <= 0 || wantsLessMotion())) setShown(false);

  useEffect(() => {
    if (open || !shown) return;
    const timer = window.setTimeout(() => setShown(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [open, shown, exitMs]);

  return { mounted: open || shown, closing: !open && shown };
}

/**
 * The value an overlay was opened with, kept while it plays its way out — a
 * question whose words are cleared as it closes would otherwise leave an empty
 * card on screen for the length of the exit.
 */
export function useHeldWhileOpen<T>(open: boolean, value: T): T {
  const held = useRef(value);
  if (open) held.current = value;
  return open ? value : held.current;
}

/**
 * True from the first time `open` is true. A caller that drew its overlay only
 * while open (`{open ? <Dialog open /> : null}`) unmounted it in the same
 * frame, before it could leave; drawn from the first opening on, and lazy
 * until then, it plays its way out like any other.
 */
export function useEverOpened(open: boolean): boolean {
  const [ever, setEver] = useState(open);
  if (open && !ever) setEver(true);
  return ever || open;
}
