import { describe, expect, it } from "vitest";
import { clampPan, panAbout } from "./zoomMath";

const stage = { width: 390, height: 700 };
const photo = { width: 390, height: 390 };

describe("zooming a photo under a finger", () => {
  /* The point of the photo under the fingers stays under them: zooming about
     the middle pushed a pinch on a label's corner off the screen. */
  it("keeps the point under the fingers where it was", () => {
    const at = { x: 100, y: -50 };
    const pan = panAbout(at, { x: 0, y: 0 }, 1, 2.5);
    // The photo's own point under `at` before: (at - pan) / scale = at.
    expect({ x: (at.x - pan.x) / 2.5, y: (at.y - pan.y) / 2.5 }).toEqual(at);
  });

  it("zooms about the middle when the fingers are at the middle", () => {
    expect(panAbout({ x: 0, y: 0 }, { x: 0, y: 0 }, 1, 3)).toEqual({ x: 0, y: 0 });
  });

  it("is undone by zooming back about the same point", () => {
    const at = { x: -40, y: 70 };
    const there = panAbout(at, { x: 12, y: -8 }, 1.5, 3);
    const back = panAbout(at, there, 3, 1.5);
    expect(back.x).toBeCloseTo(12);
    expect(back.y).toBeCloseTo(-8);
  });
});

describe("how far a zoomed photo moves", () => {
  /* As far as it hangs over the screen, so a drag never ends on an empty
     square with nothing left to drag back. */
  it("stops where the photo's edge meets the screen's", () => {
    // 390 wide at 2x is 780: 195 over each side.
    expect(clampPan({ x: 500, y: 0 }, 2, photo, stage)).toEqual({ x: 195, y: 0 });
    expect(clampPan({ x: -500, y: 0 }, 2, photo, stage)).toEqual({ x: -195, y: 0 });
  });

  it("does not move along a side the photo does not overhang", () => {
    // 390 tall at 1.5x is 585, inside 700: nothing to move up or down.
    expect(clampPan({ x: 0, y: 120 }, 1.5, photo, stage)).toEqual({ x: 0, y: 0 });
  });

  it("does not move at all at its own size", () => {
    expect(clampPan({ x: 80, y: -80 }, 1, photo, stage)).toEqual({ x: 0, y: 0 });
  });
});
