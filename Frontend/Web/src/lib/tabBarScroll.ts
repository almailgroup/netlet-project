/**
 * When the phone's tab bar steps out of the way, on the owner's word: it slides
 * away once the shopper has scrolled *down a little*, and comes back as soon as
 * they scroll up — never on the first pixel of a scroll, which would make the
 * bar flicker under a finger that only meant to settle the page.
 *
 * The rule is the distance travelled in one direction, reset whenever the
 * direction turns: `TUCK_AFTER` down sends it away, `SHOW_AFTER` up brings it
 * back, so a small bounce either way changes nothing. Near the top of a page it
 * is always there, and at its foot too, where there is nothing more to scroll
 * to and the page has kept room for it. A single move longer than a screen is a
 * jump (Back restoring a position, a link to an anchor), not somebody
 * scrolling, and shows it.
 *
 * Pure, so the same numbers decide the web's bar and are what the app's
 * `TabBarScroll.swift` follows.
 */

/** How far down, in one go, before the bar slides away. */
export const TUCK_AFTER = 64;
/** How far back up before it returns. */
export const SHOW_AFTER = 12;
/** Within this of the top of a page the bar is always shown. */
export const TOP_ZONE = 96;

export type TabBarScroll = {
  /** Out of the way. */
  away: boolean;
  /** Distance travelled since the direction last turned: down is positive. */
  travel: number;
  /** The scroll position this was decided at. */
  y: number;
};

export const SHOWN: TabBarScroll = { away: false, travel: 0, y: 0 };

export function nextTabBar(
  state: TabBarScroll,
  y: number,
  page: { viewport: number; height: number },
): TabBarScroll {
  const delta = y - state.y;
  if (y <= TOP_ZONE) return { away: false, travel: 0, y };
  if (y + page.viewport >= page.height - 2) return { away: false, travel: 0, y };
  if (Math.abs(delta) > page.viewport) return { away: false, travel: 0, y };
  if (delta === 0) return state;
  if (delta > 0) {
    const travel = Math.max(state.travel, 0) + delta;
    return { away: state.away || travel >= TUCK_AFTER, travel, y };
  }
  const travel = Math.min(state.travel, 0) + delta;
  return { away: state.away && -travel < SHOW_AFTER, travel, y };
}
