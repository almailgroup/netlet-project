/**
 * Where a sticky column sticks, so its foot is never off the screen.
 *
 * The product page's photo column is sticky beside the buy box on a wide
 * screen, and the product assistant sits under the photo in it. Stuck at the
 * usual offset under the header, a column taller than the screen hides its
 * foot — the assistant's box — for as long as the buy box beside it scrolls,
 * and a sticky element is never scrolled to its own end. So the column sticks
 * at the usual offset while it fits, and once it does not (an answer opened
 * under the photo, a short window) at whatever offset puts its foot `gap`
 * above the bottom of the screen: it scrolls with the page until its foot is
 * in view, then holds there. Measured again whenever the column or the window
 * changes size.
 */
import { useEffect, useState, type RefObject } from "react";

export function useStickyFoot(ref: RefObject<HTMLElement | null>, preferred: number, gap = 16): number {
  const [top, setTop] = useState(preferred);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setTop(Math.min(preferred, window.innerHeight - node.offsetHeight - gap));
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, preferred, gap]);
  return top;
}
