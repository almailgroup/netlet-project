/**
 * Press and hold, for a finger (3.1.11: Quick View opens on "a tap or
 * long-press on a product" on the listing pages).
 *
 * Touch only. A mouse has the preview disc on hover, and a mouse held down is
 * somebody starting a drag. The hold is `LONG_PRESS_MS`; a finger that moves
 * more than a few pixels is scrolling or swiping the photos, and the browser
 * cancels the pointer for a scroll anyway. Once the hold has fired, the click
 * the lifting finger sends is swallowed — **wherever it lands**, because by
 * then the preview is open under the finger, and its own photo is a link to
 * the product: swallowed on the card alone, the lift opened the product page
 * from the preview (found by holding a card in phone emulation). So is the
 * browser's own long-press menu (the link preview on iOS, the context menu on
 * Android), which would otherwise open over it.
 */
import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

export const LONG_PRESS_MS = 450;
const SLOP_PX = 10;

/** How soon after the finger lifts its click arrives; a click later than this is somebody's next tap. */
const LIFT_CLICK_MS = 400;

/**
 * Eats the click the lifting finger sends, wherever it lands, and nothing
 * else: it listens from the hold until the lift and for `LIFT_CLICK_MS`
 * after it, then stops — a browser that sends no click after a hold (Safari
 * with the callout off) must not cost the shopper their next tap.
 */
function swallowLiftClick() {
  let liftedAt: number | null = null;
  const lifted = () => {
    liftedAt = performance.now();
    window.setTimeout(stop, LIFT_CLICK_MS);
  };
  const eat = (event: Event) => {
    if (liftedAt !== null && performance.now() - liftedAt > LIFT_CLICK_MS) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  function stop() {
    window.removeEventListener("pointerup", lifted, true);
    window.removeEventListener("pointercancel", stop, true);
    window.removeEventListener("click", eat, true);
  }
  window.addEventListener("pointerup", lifted, true);
  window.addEventListener("pointercancel", stop, true);
  window.addEventListener("click", eat, true);
}

export function useLongPress(onLongPress: (() => void) | undefined) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  if (!onLongPress) return {};
  return {
    onPointerDown: (event: PointerEvent) => {
      fired.current = false;
      if (event.pointerType !== "touch") return;
      clear();
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        swallowLiftClick();
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      if (!start.current) return;
      if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > SLOP_PX) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onContextMenu: (event: MouseEvent) => {
      if (fired.current || start.current) event.preventDefault();
    },
  };
}
