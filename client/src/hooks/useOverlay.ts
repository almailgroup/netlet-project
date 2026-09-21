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

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
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
      window.removeEventListener("keydown", onKeyDown);
      body.style.overflow = previousOverflow;
      body.style.paddingInlineEnd = previousPadding;
      // Only if focus is still inside the overlay being torn down; if the
      // shopper has already clicked something else, leave them there.
      if (!opener.current) return;
      const active = document.activeElement;
      if (!active || active === document.body || !document.contains(active)) opener.current.focus();
    };
  }, [open]);
}
