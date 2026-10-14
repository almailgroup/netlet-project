/**
 * The class a page wears when the shopper — or the seller — moves to it.
 *
 * `page-enter` fades the page in over 180ms (opacity only; see `index.css`),
 * and only on a move: the page somebody lands on first is never faded, since
 * a page that arrives at opacity 0 has its largest picture painted later than
 * it could be. Once anybody has moved, every page after that fades, the first
 * one included if they come back to it — it is a new arrival then.
 *
 * Read during render and stable for a page's whole life: a page that
 * re-renders for its own reasons keeps the class it mounted with, so the fade
 * runs once and never again on a re-render. Both frames use it — the shop's
 * (`StorefrontShell`) and the portal's (`AdminLayout`) — so the two move the
 * same way.
 */
import { useRef } from "react";

export function usePageEntrance(page: string): string {
  const landedOn = useRef(page);
  const moved = useRef(false);
  if (page !== landedOn.current) moved.current = true;
  return moved.current ? "page-enter" : "";
}
