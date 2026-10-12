/**
 * Whether a media query matches, kept current as the window changes.
 *
 * For the few places that draw a different *structure* at a width rather than
 * the same structure styled differently — rendering both and hiding one with
 * CSS would put every id, and every panel, on the page twice.
 */
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const apply = () => setMatches(list.matches);
    apply();
    list.addEventListener("change", apply);
    return () => list.removeEventListener("change", apply);
  }, [query]);
  return matches;
}
