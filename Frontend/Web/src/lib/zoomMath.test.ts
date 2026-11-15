import { describe, expect, it } from "vitest";
import { clampPan, MAX_ZOOM, panAbout, panToPoint, TAP_ZOOM, wheelZoom } from "./zoomMath";

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

describe("the mouse wheel", () => {
  const notch = (deltaY: number, deltaMode = 0, ctrlKey = false) => ({ deltaY, deltaMode, ctrlKey });

  it("zooms in turning up and out turning down, evenly", () => {
    const closer = wheelZoom(1, notch(-100), 800);
    expect(closer).toBeGreaterThan(1.2);
    expect(closer).toBeLessThan(1.3);
    expect(wheelZoom(closer, notch(100), 800)).toBeCloseTo(1);
  });

  it("stays between the photo's own size and the closest zoom", () => {
    expect(wheelZoom(1, notch(300), 800)).toBe(1);
    expect(wheelZoom(MAX_ZOOM, notch(-300), 800)).toBe(MAX_ZOOM);
  });

  it("reads a turn counted in lines or pages as the pixels it is", () => {
    expect(wheelZoom(1, notch(-3, 1), 800)).toBeCloseTo(wheelZoom(1, notch(-48), 800));
    expect(wheelZoom(1, notch(-0.1, 2), 800)).toBeCloseTo(wheelZoom(1, notch(-80), 800));
  });

  /* A trackpad's pinch is a wheel with Ctrl held and small deltas. */
  it("reads a trackpad's pinch more strongly", () => {
    expect(wheelZoom(1, notch(-10, 0, true), 800)).toBeGreaterThan(wheelZoom(1, notch(-10), 800));
  });
});

describe("zooming in where the product page was double-clicked", () => {
  it("puts that point of the photo under the pointer", () => {
    const at = { x: 120, y: -40 };
    const pan = panToPoint({ x: 0.75, y: 0.25 }, photo, TAP_ZOOM, at);
    // The photo's point (0.25 of its width right of the middle, a quarter up) ends at `at`.
    expect(pan.x + (0.25 * photo.width) * TAP_ZOOM).toBeCloseTo(at.x);
    expect(pan.y + (-0.25 * photo.height) * TAP_ZOOM).toBeCloseTo(at.y);
  });

  it("leaves the middle in the middle", () => {
    expect(panToPoint({ x: 0.5, y: 0.5 }, photo, 3, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
