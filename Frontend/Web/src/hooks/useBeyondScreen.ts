/**
 * Whether an element has gone past one edge of the screen — above the top, or
 * below the bottom — which is what decides when a phone's floating action bar
 * stands in for the page's own button.
 *
 * The product page's buy bar shows once Add to cart has scrolled away *above*;
 * the cart's and checkout's show while their button is still *below*, not yet
 * reached. One rule for all three, so they cannot drift.
 *
 * The watched area runs from the edge that counts to far beyond the other, so
 * a jump straight across the screen — Back, a fling, an anchor — still changes
 * the answer; an observer of the screen alone sees "not visible" twice and says
 * nothing. `inset` pulls the edge in by what floats over it: at the bottom, the
 * tab bar, so a button hidden behind it counts as not yet reached.
 *
 * A callback ref, because the button may first exist a render or two after
 * the hook does (a loading state comes first), and an effect would have run
 * while there was nothing yet to watch.
 */
import { useCallback, useState } from "react";

export function useBeyondScreen(edge: "top" | "bottom", inset = 0) {
  const [beyond, setBeyond] = useState(false);
  const ref = useCallback((node: Element | null) => {
    if (!node || typeof IntersectionObserver === "undefined") return;
    const far = "100000px";
    const observer = new IntersectionObserver(
      ([entry]) => {
        const box = entry.boundingClientRect;
        /* A hidden element measures as an empty box at 0: never beyond. */
        const hidden = box.width === 0 && box.height === 0;
        /* Measured against the watched edge, not the screen's: the observer
           speaks only as the element crosses that edge, and with an inset at
           the top it has crossed while still on screen — so "above the screen"
           was asked of a box that had not got there yet, and never asked again
           (a department's corner Filters button never appeared). */
        setBeyond(!hidden && !entry.isIntersecting && (edge === "top" ? box.bottom <= inset : box.top > 0));
      },
      { rootMargin: edge === "top" ? `-${inset}px 0px ${far} 0px` : `${far} 0px -${inset}px 0px` },
    );
    observer.observe(node);
    return () => { observer.disconnect(); setBeyond(false); };
  }, [edge, inset]);
  return [ref, beyond] as const;
}
