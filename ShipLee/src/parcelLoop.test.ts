import { describe, expect, it } from "vitest";
import { ABOVE, clearOf, countFor, parcelBox, parcelLoop, phasesFor, pointAt, spacingFor, speedFor } from "./parcelLoop.js";
import type { LoopInput } from "./parcelLoop.js";

/** The home band as measured in a browser, at each width the site is walked at. */
const LAYOUTS: Record<string, LoopInput> = {
  phone320: { width: 320, height: 806, content: { left: 16, top: 48, right: 304, bottom: 751 }, parcel: 26, rtl: false },
  phone390: { width: 390, height: 620, content: { left: 16, top: 48, right: 374, bottom: 564 }, parcel: 26, rtl: false },
  tablet768: { width: 768, height: 516, content: { left: 24, top: 48, right: 664, bottom: 460 }, parcel: 28, rtl: false },
  laptop1024: { width: 1024, height: 580, content: { left: 24, top: 80, right: 1000, bottom: 492 }, parcel: 32, rtl: false },
  wide1440: { width: 1440, height: 580, content: { left: 160, top: 80, right: 1280, bottom: 492 }, parcel: 32, rtl: false },
};

const loopFor = (input: LoopInput) => {
  const loop = parcelLoop(input);
  if (!loop) throw new Error("no loop");
  return loop;
};

describe("the road round the home band", () => {
  for (const [name, input] of Object.entries(LAYOUTS)) {
    for (const rtl of [false, true]) {
      const layout = { ...input, rtl };
      const label = `${name}${rtl ? " in Arabic" : ""}`;

      it(`never takes a parcel across the words (${label})`, () => {
        const loop = loopFor(layout);
        /* Every point the road is drawn through, and a thousand between them. */
        for (const p of loop.points) expect(clearOf(layout.content, p.x, p.y, layout.parcel)).toBe(true);
        for (let i = 0; i < 1000; i++) {
          const p = pointAt(loop, i / 1000);
          expect(clearOf(layout.content, p.x, p.y, layout.parcel)).toBe(true);
        }
      });

      it(`is closed, and measured evenly from 0 to 1 (${label})`, () => {
        const loop = loopFor(layout);
        const first = loop.points[0]!;
        const last = loop.points[loop.points.length - 1]!;
        expect(first.at).toBe(0);
        expect(last.at).toBe(1);
        expect(last.x).toBeCloseTo(first.x, 6);
        expect(last.y).toBeCloseTo(first.y, 6);
        for (let i = 1; i < loop.points.length; i++) expect(loop.points[i]!.at).toBeGreaterThan(loop.points[i - 1]!.at);
        expect(loop.d.startsWith("M")).toBe(true);
        expect(loop.d.endsWith("Z")).toBe(true);
      });

      it(`keeps a parcel on a lane inside the band (${label})`, () => {
        const loop = loopFor(layout);
        for (let i = 0; i < 1000; i++) {
          const p = pointAt(loop, i / 1000);
          if (p.x < 0 || p.x > layout.width) continue;
          const box = parcelBox(p.x, p.y, layout.parcel);
          /* Above the headline or below the card: whole, never cut by the band's edge. */
          if (box.bottom <= layout.content.top) expect(box.top).toBeGreaterThanOrEqual(0);
          if (box.top >= layout.content.bottom) expect(box.bottom).toBeLessThanOrEqual(layout.height);
        }
      });
    }
  }

  it("runs a lane above the headline and a lane under the card", () => {
    const { content, height, parcel } = LAYOUTS.phone390!;
    const loop = loopFor(LAYOUTS.phone390!);
    const above = loop.points.filter(p => p.x > 0 && p.x < 390 && p.y < content.top);
    const below = loop.points.filter(p => p.x > 0 && p.x < 390 && p.y > content.bottom);
    expect(above.length).toBeGreaterThan(20);
    expect(below.length).toBeGreaterThan(20);
    /* Each parcel's box is centred in its strip, give or take the lane's wander. */
    for (const p of below) {
      const box = parcelBox(p.x, p.y, parcel);
      expect(Math.abs((box.top + box.bottom) / 2 - (content.bottom + height) / 2)).toBeLessThanOrEqual(8);
    }
  });

  it("takes the sides past the band's edges on a phone, where there is no margin", () => {
    const loop = loopFor(LAYOUTS.phone390!);
    expect(loop.points.some(p => p.x < 0)).toBe(true);
    expect(loop.points.some(p => p.x > 390)).toBe(true);
  });

  it("takes the sides down the margins on a wide screen, in sight", () => {
    const loop = loopFor(LAYOUTS.wide1440!);
    const along = Array.from({ length: 1000 }, (_, i) => pointAt(loop, i / 1000));
    expect(along.every(p => p.x >= 0 && p.x <= 1440)).toBe(true);
    expect(along.some(p => p.x < 160 && p.y > 200 && p.y < 400)).toBe(true);
    expect(along.some(p => p.x > 1280 && p.y > 200 && p.y < 400)).toBe(true);
  });

  it("goes along the bottom in the reading direction: left to right in English, right to left in Arabic", () => {
    for (const rtl of [false, true]) {
      const layout = { ...LAYOUTS.wide1440!, rtl };
      const loop = loopFor(layout);
      const bottom = loop.points.filter(p => p.y > layout.content.bottom && p.x > 300 && p.x < 1100);
      const moves = bottom.slice(1).map((p, i) => Math.sign(p.x - bottom[i]!.x)).filter(step => step !== 0);
      expect(moves.length).toBeGreaterThan(50);
      expect(moves.every(step => step === (rtl ? -1 : 1))).toBe(true);
    }
  });

  it("draws no road when the words fill the band", () => {
    expect(parcelLoop({ width: 390, height: 300, content: { left: 4, top: 4, right: 386, bottom: 296 }, parcel: 22, rtl: false })).toBeNull();
    expect(parcelLoop({ width: 0, height: 300, content: { left: 0, top: 0, right: 0, bottom: 0 }, parcel: 22, rtl: false })).toBeNull();
  });

  it("finds a point by how far round it is, wrapping past the end", () => {
    const loop = loopFor(LAYOUTS.tablet768!);
    const start = pointAt(loop, 0);
    expect(start.x).toBeCloseTo(loop.points[0]!.x, 6);
    expect(pointAt(loop, 1).x).toBeCloseTo(start.x, 6);
    expect(pointAt(loop, 1.25).x).toBeCloseTo(pointAt(loop, 0.25).x, 6);
    expect(pointAt(loop, -0.25).y).toBeCloseTo(pointAt(loop, 0.75).y, 6);
  });

  it("spaces the parcels round the loop without two in one place", () => {
    for (const count of [3, 7, 12, 16]) {
      const phases = phasesFor(count).sort((a, b) => a - b);
      expect(phases).toHaveLength(count);
      for (const phase of phases) expect(phase >= 0 && phase < 1).toBe(true);
      const gaps = phases.map((phase, i) => (i === 0 ? phase + 1 - phases[count - 1]! : phase - phases[i - 1]!));
      for (const gap of gaps) expect(gap).toBeGreaterThan(0.5 / count);
    }
  });

  it("keeps the pace calm and the count sensible", () => {
    expect(speedFor(320)).toBe(48);
    expect(speedFor(1920)).toBe(78);
    expect(spacingFor(390)).toBe(220);
    expect(spacingFor(1920)).toBe(320);
    expect(countFor(100, 390)).toBe(3);
    expect(countFor(100_000, 1440)).toBe(16);
    expect(ABOVE).toBeGreaterThan(0.5);
  });
});
