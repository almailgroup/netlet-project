import { describe, expect, it } from "vitest";
import { nextTabBar, SHOW_AFTER, SHOWN, TOP_ZONE, TUCK_AFTER, type TabBarScroll } from "./tabBarScroll";

const page = { viewport: 800, height: 5000 };

/** Rests at the first position, then scrolls through the rest a frame at a time. */
function scroll([first, ...rest]: number[], from: TabBarScroll = { ...SHOWN, y: first }): TabBarScroll {
  return rest.reduce((state, y) => nextTabBar(state, y, page), from);
}

describe("the tab bar on a scroll", () => {
  it("stays while the scroll down is still short", () => {
    const start = TOP_ZONE + 100;
    const state = scroll([start, start + 20, start + 40, start + TUCK_AFTER - 1]);
    expect(state.away).toBe(false);
  });

  it("slides away once the scroll down has gone far enough", () => {
    const start = TOP_ZONE + 100;
    expect(scroll([start, start + 30, start + TUCK_AFTER]).away).toBe(true);
  });

  it("counts only the distance since the direction last turned", () => {
    const start = TOP_ZONE + 200;
    /* Down 50, back up 5, down 50 again: never 64 in one go. */
    expect(scroll([start, start + 50, start + 45, start + 95]).away).toBe(false);
  });

  it("comes back on a scroll up, and not on a bounce", () => {
    const start = TOP_ZONE + 400;
    const away = scroll([start, start + 200]);
    expect(away.away).toBe(true);
    expect(nextTabBar(away, start + 200 - (SHOW_AFTER - 1), page).away).toBe(true);
    expect(nextTabBar(away, start + 200 - SHOW_AFTER, page).away).toBe(false);
  });

  it("starts counting at the edge of the top zone, not at the top", () => {
    /* From the top, the first 64 pixels past the zone are the allowance. */
    const steps = Array.from({ length: 20 }, (_, i) => i * 8);
    expect(scroll(steps).away).toBe(false);
    expect(scroll([...steps, TOP_ZONE + TUCK_AFTER]).away).toBe(true);
  });

  it("is always there near the top of the page", () => {
    const away = scroll([TOP_ZONE + 300, TOP_ZONE + 600]);
    expect(away.away).toBe(true);
    expect(nextTabBar(away, TOP_ZONE, page).away).toBe(false);
  });

  it("is there at the foot of the page, where there is nothing more to scroll to", () => {
    const away = scroll([1000, 1400]);
    expect(away.away).toBe(true);
    expect(nextTabBar(away, page.height - page.viewport, page).away).toBe(false);
  });

  it("takes a jump longer than a screen for a jump, not a scroll", () => {
    const state = scroll([TOP_ZONE + 10, 3000]);
    expect(state.away).toBe(false);
    /* And the scroll after it starts counting afresh. */
    expect(nextTabBar(state, 3000 + TUCK_AFTER - 1, page).away).toBe(false);
  });

  it("changes nothing when nothing moved", () => {
    const away = scroll([500, 700]);
    expect(nextTabBar(away, 700, page)).toBe(away);
  });
});
