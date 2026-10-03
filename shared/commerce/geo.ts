/**
 * A pin on a map (3.2.7): where exactly a parcel goes.
 *
 * Kuwaiti addresses are block, street and building, and a driver who has all
 * three still rings the shopper from the end of the road — street numbers are
 * reused across blocks, buildings go unmarked, and a villa's gate is not where
 * the map draws the plot. A pin is what ends that phone call, so the address
 * book and checkout both offer one.
 *
 * Pure and imported by both sides, for the reason the password floor is: the
 * picker refuses what the API would, and the API refuses what the picker does.
 *
 * ## The pin is optional and the words are not
 *
 * A typed address is still required, and a pin never replaces it. Somebody
 * without location access, on a slow connection that never draws the tiles,
 * or who simply does not want to hand over where they live, must still be able
 * to buy something — the same direction every other optional field here errs
 * in. The pin is a better answer, not the only one.
 *
 * ## One value, not two columns
 *
 * A latitude without its longitude is not a place. Stored as one `{ lat, lng }`
 * value rather than two columns that must both be set or both be null, for the
 * reason this codebase keeps giving: two fields that must agree eventually do
 * not.
 *
 * ## Inside Kuwait, and no more precise than a doorstep
 *
 * NetLet delivers in Kuwait, so a pin outside it is a slip of the finger
 * rather than an address, and is refused rather than dispatched to Basra. The
 * box is generous — it takes Bubiyan and Failaka — because refusing a real
 * address in a corner of the country is worse than accepting a pin in the
 * neighbouring desert. Coordinates are kept to five decimal places, about a
 * metre: a finer figure claims a precision no phone's GPS has, and a coarser
 * one is the wrong gate.
 */
import type { MessageKey } from "../i18n/dictionary.js";

export type Pin = { lat: number; lng: number };

/** Kuwait with a margin, islands included. */
export const KUWAIT_BOUNDS = { south: 28.5, north: 30.15, west: 46.5, east: 48.6 } as const;

/** Where the map opens when nothing better is known: Kuwait City. */
export const KUWAIT_CENTRE: Pin = { lat: 29.3759, lng: 47.9774 };

/**
 * Roughly the middle of each governorate, by the ids in `shared/customer.ts`,
 * so choosing one moves the map there rather than leaving the shopper to pan
 * across the country.
 */
export const GOVERNORATE_CENTRES: Record<string, Pin> = {
  capital: { lat: 29.3697, lng: 47.9783 },
  hawalli: { lat: 29.3328, lng: 48.0286 },
  farwaniya: { lat: 29.2775, lng: 47.9585 },
  ahmadi: { lat: 29.0769, lng: 48.0838 },
  jahra: { lat: 29.3375, lng: 47.6581 },
  "mubarak-al-kabeer": { lat: 29.1859, lng: 48.0612 },
};

/**
 * Where the map's pictures come from: OpenStreetMap's own tile server, which
 * needs no key and no account, on the terms that it is credited on the map and
 * used lightly — a picker opened at checkout is exactly that. The origin is
 * named here because the CSP has to allow it when `MEDIA_HOST` narrows images
 * to one host.
 */
export const MAP_TILE_ORIGIN = "https://tile.openstreetmap.org";
export const MAP_TILES = `${MAP_TILE_ORIGIN}/{z}/{x}/{y}.png`;

const DECIMALS = 5;

export type PinProblem = Extract<MessageKey, "address.badPin" | "address.pinOutsideKuwait">;

/** What is wrong with a pin, as one of two keys, or null when it can be kept. */
export function pinProblem(pin: Pin): PinProblem | null {
  if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) return "address.badPin";
  const { south, north, west, east } = KUWAIT_BOUNDS;
  if (pin.lat < south || pin.lat > north || pin.lng < west || pin.lng > east) return "address.pinOutsideKuwait";
  return null;
}

/** The pin as stored: five decimal places, about a metre. */
export function cleanPin(pin: Pin): Pin {
  const factor = 10 ** DECIMALS;
  return { lat: Math.round(pin.lat * factor) / factor, lng: Math.round(pin.lng * factor) / factor };
}

/** A pin kept, or null for a missing or unusable one — never a half value. */
export function storedPin(pin: Pin | null | undefined): Pin | null {
  if (!pin || pinProblem(pin)) return null;
  return cleanPin(pin);
}

/**
 * A link that opens the pin in whatever maps app the driver's phone has.
 *
 * Google's documented maps URL rather than a `geo:` URI, because iOS does not
 * open `geo:` and most drivers carry an iPhone or an Android with Google Maps
 * on it; on a phone without it, the link opens the same place in a browser.
 */
export function mapsLink(pin: Pin): string {
  const { lat, lng } = cleanPin(pin);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Where to centre a map for a governorate, or the capital when there is none. */
export function centreFor(governorate: string | null | undefined): Pin {
  return (governorate && GOVERNORATE_CENTRES[governorate]) || KUWAIT_CENTRE;
}

/** "29.37590, 47.97740" — always Latin digits, always five places. */
export function formatPin(pin: Pin): string {
  return `${pin.lat.toFixed(DECIMALS)}, ${pin.lng.toFixed(DECIMALS)}`;
}
