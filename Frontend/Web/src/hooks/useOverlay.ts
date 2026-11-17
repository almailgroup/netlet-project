/**
 * The behaviour every overlay is expected to have, in one place.
 *
 * A drawer, a dialog and a bottom sheet all owe the person who opened them the
 * same three things, and NetLet's were each missing a different one:
 *
 *   - Escape closes it. Reaching for the mouse to leave a panel you opened with
 *     a keystroke is the kind of small friction that makes software feel
 *     unfinished.
 *   - Focus goes back where it came from. Without this, closing a drawer
 *     drops the keyboard at the top of the document and a shopper has to tab
 *     through the whole header to get back to the product they were looking at.
 *   - The page behind stops scrolling. A sheet that scrolls the catalog under
 *     itself loses the shopper's place while they are ticking a filter.
 */
import { useEffect, useRef } from "react";

/*
 * The overlays open right now, oldest first. Escape closes only the one on
 * top: the product photos open a full-screen viewer over their own list, and
 * one Escape closing both — every listener on `window` hears the key — threw
 * the shopper out of the photos altogether when they meant to step back one.
 */
const openOverlays: symbol[] = [];

/*
 * Tab stays inside the modal dialog that holds focus, going round from its
 * last stop to its first and back. A modal says the page behind is not there
 * (`aria-modal`), yet Tab walked out of the bag drawer into the header under
 * the dim — the keyboard on a link nobody could see — and on to the end of
 * the page. Only the ends are caught; between them the browser moves focus
 * as it always does, so a dialog's own order is untouched.
 */
const TAB_STOPS = "a[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable='true']";

function tabStops(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(TAB_STOPS)).filter(element =>
    element.tabIndex >= 0 &&
    !(element as HTMLButtonElement).disabled &&
    !element.closest("[inert]") &&
    element.getClientRects().length > 0,
  );
}

function keepTabInside(event: KeyboardEvent) {
  const active = document.activeElement as HTMLElement | null;
  const dialog = active?.closest<HTMLElement>('[aria-modal="true"]');
  if (!active || !dialog) return;
  const stops = tabStops(dialog);
  if (!stops.length) return;
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (event.shiftKey && (active === first || active === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function useOverlay(open: boolean, onClose: () => void) {
  const opener = useRef<HTMLElement | null>(null);

  /*
   * Callers pass an inline arrow, so `onClose` is a new function on every
   * render of the page holding the overlay. Depending on it directly tore the
   * effect down and set it up again on each of those renders — which meant the
   * scroll lock's "what was here before" was re-captured from a body that was
   * already locked, and the page stayed frozen after the overlay closed.
   *
   * The ref keeps the latest callback without making it a dependency, so the
   * effect runs once per open and once per close, which is what it describes.
   */
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;

    opener.current = document.activeElement as HTMLElement | null;
    const self = Symbol("overlay");
    openOverlays.push(self);

    const onKeyDown = (event: KeyboardEvent) => {
      if (openOverlays[openOverlays.length - 1] !== self) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      } else if (event.key === "Tab") {
        keepTabInside(event);
      }
    };
    window.addEventListener("keydown", onKeyDown);

    // The scrollbar's width is compensated so the page does not jump sideways
    // as it locks — a shift of a few pixels behind a modal reads as a glitch.
    const { body, documentElement } = document;
    const gap = window.innerWidth - documentElement.clientWidth;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingInlineEnd;
    body.style.overflow = "hidden";
    if (gap > 0) body.style.paddingInlineEnd = `${gap}px`;

    return () => {
      openOverlays.splice(openOverlays.indexOf(self), 1);
      window.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
      body.style.paddingInlineEnd = previousPadding;
      // Only if focus is still inside the overlay being torn down; if the
      // shopper has already clicked something else, leave them there.
      // Without scrolling: the page could not move while this was open, so
      // the opener is where it was — but a click on something that takes no
      // focus (a product's photo) hands it to the nearest focusable
      // ancestor, the page's `<main>`, and focusing that scrolled the page
      // 125px down as the photos closed.
      if (!opener.current) return;
      const active = document.activeElement;
      // An overlay playing its way out (`usePresence`) is still drawn, inert:
      // focus left inside it has left, as it would have had it unmounted.
      if (!active || active === document.body || !document.contains(active) || active.closest("[inert]")) opener.current.focus({ preventScroll: true });
    };
  }, [open]);
}
