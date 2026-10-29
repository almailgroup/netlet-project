/**
 * A row that scrolls sideways, and whether there is anything off either end.
 *
 * The home page's shelves, its departments and its brands are each one of
 * these: a finger swipes them, and a mouse gets arrows beside the heading that
 * move a screenful at a time and are drawn only while there is something to
 * reach (`ScrollArrows`). `scrollLeft` runs negative on a right-to-left page,
 * so each end is measured by its distance rather than by the sign.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type SideScroll<T extends HTMLElement = HTMLElement> = {
  trackRef: React.RefObject<T | null>;
  edges: { back: boolean; forward: boolean };
  scrollBy: (direction: -1 | 1) => void;
};

/** `deps` are whatever changes what the row holds, so the ends are measured again. */
export function useSideScroll<T extends HTMLElement>(deps: readonly unknown[] = []): SideScroll<T> {
  const trackRef = useRef<T | null>(null);
  const [edges, setEdges] = useState({ back: false, forward: false });

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const travelled = Math.abs(track.scrollLeft);
      const room = track.scrollWidth - track.clientWidth;
      setEdges(before => {
        const next = { back: travelled > 4, forward: room - travelled > 4 };
        return before.back === next.back && before.forward === next.forward ? before : next;
      });
    };
    measure();
    track.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(track);
    return () => { track.removeEventListener("scroll", measure); observer?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const scrollBy = useCallback((direction: -1 | 1) => {
    const track = trackRef.current;
    if (!track) return;
    const rtl = getComputedStyle(track).direction === "rtl";
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({ left: (rtl ? -direction : direction) * Math.round(track.clientWidth * 0.9), behavior: still ? "instant" : "smooth" });
  }, []);

  return { trackRef, edges, scrollBy };
}
