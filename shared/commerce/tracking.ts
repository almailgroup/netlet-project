/**
 * Live tracking (3.4.3): where the driver is, and roughly how long until the
 * door.
 *
 * Pure and shared, because what it produces is a promise a shopper decides
 * whether to wait in for — the reason the delivery bands are pure.
 *
 * ## The driver chooses, and only the latest point exists
 *
 * A position is shared from the dispatch board by a driver who pressed "share
 * my location", while that page is open, and it is one row per driver,
 * overwritten: there is no trail of where anybody has been. It is shown only
 * to a shopper whose parcel that driver is carrying right now — collected and
 * not yet handed over — and only while it is fresh. A position older than
 * `STALE_AFTER_MS` is not "where the driver is", it is where they were, so it
 * is not drawn at all rather than drawn as though it were current.
 *
 * ## The estimate is a band from distance, and says so
 *
 * NetLet has no routing service and no traffic data, so anything precise would
 * be invented. The estimate is the straight-line distance stretched by a road
 * factor, at a city speed, plus the minutes it takes to park and reach a door,
 * and it is given as a five-minute band — "15 to 20 minutes" — never as a
 * clock time the shop would then be held to. It moves because the driver
 * moves: each fresh position gives a new band.
 *
 * With no pin on the address there is nothing to measure to, and the panel
 * shows the driver on the map without a time rather than guessing from the
 * middle of a governorate.
 */
import type { Pin } from "./geo.js";

/** A shared position older than this is not shown. */
export const STALE_AFTER_MS = 10 * 60 * 1000;
/** The least time between two positions the server keeps from one driver. */
export const MIN_SHARE_INTERVAL_MS = 10 * 1000;

/** Roads are not straight lines; this is roughly how much longer they are in a Kuwaiti city. */
const ROAD_FACTOR = 1.35;
/** An average city speed, stops and lights included. */
const CITY_KMH = 30;
/** Parking, the building, the lift. */
const DOORSTEP_MINUTES = 3;
/** Closer than this, the band is "arriving now". */
const ARRIVING_KM = 0.3;
const BAND_MINUTES = 5;

const EARTH_KM = 6371;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance between two points, in kilometres. */
export function distanceKm(a: Pin, b: Pin): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type Eta =
  | { kind: "arriving" }
  /** Between `low` and `high` minutes, both multiples of five. */
  | { kind: "band"; low: number; high: number };

/** How long from here to the door, as a band. */
export function etaFor(driver: Pin, door: Pin): Eta {
  const km = distanceKm(driver, door);
  if (km < ARRIVING_KM) return { kind: "arriving" };
  const minutes = (km * ROAD_FACTOR / CITY_KMH) * 60 + DOORSTEP_MINUTES;
  const low = Math.max(BAND_MINUTES, Math.floor(minutes / BAND_MINUTES) * BAND_MINUTES);
  return { kind: "band", low, high: low + BAND_MINUTES };
}

/** Whether a position recorded at `recordedAt` may still be shown at `now`. */
export function isFresh(recordedAt: Date, now: Date): boolean {
  const age = now.getTime() - recordedAt.getTime();
  return age >= 0 && age <= STALE_AFTER_MS;
}
