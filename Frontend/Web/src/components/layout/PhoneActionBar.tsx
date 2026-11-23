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
 * guard shortens to nothing for somebody who asked for less. Over the tab bar
 * it rides it (`.rides-tab-bar`): when the bar slides away on a scroll down,
 * this drops into the room it left rather than hanging over an empty strip.
 */
import type { ReactNode } from "react";
import { useFloatingBar } from "@/hooks/useFloatingBar";

export function PhoneActionBar({ shown, label, overTabBar = true, glass = false, children }: {
  shown: boolean;
  /** What the bar is, for a screen reader's map of the page. */
  label: string;
  /** Over the tab bar on a shopping page; at the foot of the screen elsewhere. */
  overTabBar?: boolean;
  /**
   * A pane of the tab bar's Liquid Glass rather than a white card — the
   * order's chosen items, on the owner's word. It comes and goes by a
   * transform and its contents fade (`.glass-float`), because an opacity on
   * the bar would drain its glass to white for as long as the fade ran.
   */
  glass?: boolean;
  children: ReactNode;
}) {
  useFloatingBar(shown);
  const place = overTabBar ? "rides-tab-bar bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.5rem)]" : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]";
  if (glass) {
    return (
      <div
        role="region"
        aria-label={label}
        aria-hidden={!shown}
        inert={!shown}
        data-hidden={shown ? undefined : ""}
        className={`glass-float glass-panel fixed inset-x-3 z-30 rounded-[24px] border border-white/70 p-2 shadow-[0_12px_32px_rgba(10,40,90,.2),0_1px_3px_rgba(10,40,90,.08)] lg:hidden ${place} ${shown ? "" : "pointer-events-none"}`}
      >
        <GlassLayers />
        <div className="glass-float-body">{children}</div>
      </div>
    );
  }
  return (
    <div
      role="region"
      aria-label={label}
      aria-hidden={!shown}
      inert={!shown}
      className={`fixed inset-x-3 z-30 rounded-2xl border border-[#e6e9ef] bg-white p-2 shadow-[0_10px_30px_rgba(10,40,90,.18)] lg:hidden ${overTabBar ? place : `transition-[opacity,translate] duration-200 ${place}`} ${shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
    >
      {children}
    </div>
  );
}

/** The tab bar's glass behind a pane's contents: blur, tint and rim, inside its corners. */
export function GlassLayers() {
  return (
    <span aria-hidden className="glass-bar-surface glass-bar-round">
      <span className="glass-bar-bend" />
      <span className="glass-bar-face" />
    </span>
  );
}

/** How far the tab bar reaches up from the foot of the screen, with its gap. */
export const TAB_BAR_REACH = 80;
