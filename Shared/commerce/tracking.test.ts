import { describe, expect, it } from "vitest";
import { STALE_AFTER_MS, distanceKm, etaFor, etaFromDrive, isFresh } from "./tracking.js";

const salmiya = { lat: 29.3339, lng: 48.0763 };
const kuwaitCity = { lat: 29.3759, lng: 47.9774 };

describe("distance", () => {
  it("measures across the city in kilometres", () => {
    expect(distanceKm(salmiya, kuwaitCity)).toBeGreaterThan(10);
    expect(distanceKm(salmiya, kuwaitCity)).toBeLessThan(11);
    expect(distanceKm(salmiya, salmiya)).toBe(0);
  });
});

describe("the estimate", () => {
  it("is a five-minute band, not a clock time", () => {
    const eta = etaFor(salmiya, kuwaitCity);
    expect(eta.kind).toBe("band");
    if (eta.kind === "band") {
      expect(eta.low % 5).toBe(0);
      expect(eta.high - eta.low).toBe(5);
      /* ~10.6 km × 1.35 at 30 km/h is ~29 minutes, plus the doorstep. */
      expect(eta.low).toBe(30);
    }
  });

  it("says arriving when the driver is at the building", () => {
    expect(etaFor({ lat: 29.3340, lng: 48.0764 }, salmiya)).toEqual({ kind: "arriving" });
  });

  it("never promises under five minutes for somebody not yet there", () => {
    expect(etaFor({ lat: 29.3370, lng: 48.0763 }, salmiya)).toEqual({ kind: "band", low: 5, high: 10, source: "distance" });
  });

  it("moves as the driver moves", () => {
    const far = etaFor(kuwaitCity, salmiya);
    const nearer = etaFor({ lat: 29.35, lng: 48.03 }, salmiya);
    expect(far.kind === "band" && nearer.kind === "band" && nearer.low < far.low).toBe(true);
  });
});

describe("the estimate from a driving time", () => {
  it("is Apple's minutes on the road plus the doorstep, in the same band, and says so", () => {
    /* 31 minutes in traffic + 3 at the door = 34, so 30 to 35. */
    expect(etaFromDrive(kuwaitCity, salmiya, 31 * 60)).toEqual({ kind: "band", low: 30, high: 35, source: "traffic" });
    /* Traffic the distance cannot see: the same trip at 52 minutes. */
    expect(etaFromDrive(kuwaitCity, salmiya, 52 * 60)).toEqual({ kind: "band", low: 55, high: 60, source: "traffic" });
  });

  it("says arriving by the same measure the distance uses", () => {
    expect(etaFromDrive({ lat: 29.3340, lng: 48.0764 }, salmiya, 240)).toEqual({ kind: "arriving" });
  });

  it("never promises under five minutes, whatever the road says", () => {
    expect(etaFromDrive({ lat: 29.3370, lng: 48.0763 }, salmiya, 0)).toEqual({ kind: "band", low: 5, high: 10, source: "traffic" });
    expect(etaFromDrive({ lat: 29.3370, lng: 48.0763 }, salmiya, -30)).toEqual({ kind: "band", low: 5, high: 10, source: "traffic" });
  });
});

describe("freshness", () => {
  const now = new Date("2026-10-04T10:00:00Z");
  it("shows a position for ten minutes and no longer", () => {
    expect(isFresh(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(isFresh(new Date(now.getTime() - STALE_AFTER_MS - 1), now)).toBe(false);
    /* A clock that has run ahead is not a fresh position either. */
    expect(isFresh(new Date(now.getTime() + 60_000), now)).toBe(false);
  });
});
