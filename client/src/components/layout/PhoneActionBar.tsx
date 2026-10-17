/**
 * The phone's floating action bar: the one thing a page is for, kept under the
 * shopper's thumb while the page's own button is off the screen.
 *
 * Three pages have one, each standing in for a button the shopper would
 * otherwise scroll for — the product page's Add to cart and Buy now once they
 * have gone above, the cart's Checkout and checkout's Place order while they
 * are still below. It floats over the tab bar where there is one, and at the
 * foot of the screen on checkout, which has none; either way it clears the
 * home indicator. A wide screen keeps its buttons in view beside the content
 * and never draws it.
 *
 * Hidden it is `inert` and out of the accessibility tree, so a keyboard or a
 * screen reader never meets two sets of the same buttons. It slides and fades
 * in from a few pixels below rather than appearing, which the global motion
 * guard shortens to nothing for somebody who asked for less.
 */
import type { ReactNode } from "react";
import { useFloatingBar } from "@/hooks/useFloatingBar";

export function PhoneActionBar({ shown, label, overTabBar = true, children }: {
  shown: boolean;
  /** What the bar is, for a screen reader's map of the page. */
  label: string;
  /** Over the tab bar on a shopping page; at the foot of the screen elsewhere. */
  overTabBar?: boolean;
  children: ReactNode;
}) {
  useFloatingBar(shown);
  return (
    <div
      role="region"
      aria-label={label}
      aria-hidden={!shown}
      inert={!shown}
      className={`fixed inset-x-3 z-30 rounded-2xl border border-[#e6e9ef] bg-white p-2 shadow-[0_10px_30px_rgba(10,40,90,.18)] transition-[opacity,translate] duration-200 lg:hidden ${overTabBar ? "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.5rem)]" : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]"} ${shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
    >
      {children}
    </div>
  );
}

/** How far the tab bar reaches up from the foot of the screen, with its gap. */
export const TAB_BAR_REACH = 80;
