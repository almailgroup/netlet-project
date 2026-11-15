import { useEffect, useRef } from "react";

/** How long after a click opened something its second click still counts. */
export const SECOND_CLICK_MS = 800;

/** Where a click that opened something landed, and when. */
export type OpeningClick = {
  /** The point on the photo, as a fraction of its width and its height. */
  x: number;
  y: number;
  /** `performance.now()` at the press. */
  at: number;
};

/**
 * The second click of a double click whose first click opened something.
 *
 * One click on a product's photo opens the photos at once, and a double click
 * zooms into the spot, on the owner's word — so the first click cannot wait to
 * learn whether a second is coming (a double-click's interval is half a second
 * on Windows, a long time for a press to do nothing), and by the time the
 * second arrives the viewer is under the pointer and it lands on whatever is
 * there, a thumbnail or the stage. This listens on `window` in the capture
 * phase, ahead of React's own listeners at the root, for a click the browser
 * counts as the second (`detail` 2) within `SECOND_CLICK_MS` of the opening
 * one: that click and the `dblclick` after it are swallowed, so neither picks
 * a thumbnail nor toggles the stage's own double-click zoom back out, and
 * `onSecond` is told instead. A press with nothing to go on — the keyboard,
 * the magnifier, "+N" — passes no opening click and nothing listens.
 */
export function useSecondClick(opening: OpeningClick | null | undefined, onSecond: (event: MouseEvent, opening: OpeningClick) => void) {
  const handler = useRef(onSecond);
  handler.current = onSecond;
  useEffect(() => {
    if (!opening) return;
    const left = SECOND_CLICK_MS - (performance.now() - opening.at);
    if (left <= 0) return;
    let used = false;
    const click = (event: MouseEvent) => {
      if (used || event.detail < 2) return;
      used = true;
      event.preventDefault();
      event.stopPropagation();
      handler.current(event, opening);
    };
    const doubled = (event: MouseEvent) => {
      if (!used) return;
      event.preventDefault();
      event.stopPropagation();
      stop();
    };
    window.addEventListener("click", click, true);
    window.addEventListener("dblclick", doubled, true);
    const timer = window.setTimeout(() => stop(), left);
    function stop() {
      window.clearTimeout(timer);
      window.removeEventListener("click", click, true);
      window.removeEventListener("dblclick", doubled, true);
    }
    return stop;
  }, [opening]);
}
