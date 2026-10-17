/**
 * Says that a floating control of the page's own is on screen: the product
 * page's buy bar, the cart's Checkout, the department page's corner Filters.
 *
 * The shop assistant's button sits in the same corner on a phone, over the
 * tab bar, and steps aside while any of these is showing (`data-floating-bar`
 * on `<html>`, read by `.assistant-launcher` in index.css) — the button a page
 * is for wins over a chat somebody may want. A count rather than a flag, so
 * two bars showing at once and one leaving does not bring the button back
 * early; written on the element directly so nothing re-renders for it.
 */
import { useEffect } from "react";

let claims = 0;

export function useFloatingBar(shown: boolean): void {
  useEffect(() => {
    if (!shown) return;
    claims += 1;
    document.documentElement.setAttribute("data-floating-bar", "");
    return () => {
      claims -= 1;
      if (claims <= 0) {
        claims = 0;
        document.documentElement.removeAttribute("data-floating-bar");
      }
    };
  }, [shown]);
}
