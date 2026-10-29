/**
 * What address a pin is on: the area, block, street and house a map service
 * knows for that point, read into the address form's parts
 * (`Shared/commerce/placeParts.ts`).
 *
 * **OpenStreetMap's Nominatim first.** Kuwait is mapped there block by block
 * — "Salmiya - Block 5", "Street 3 Lane 1", the house number when the pin is
 * on a building, the governorate's ISO code on every answer — which the Live
 * check workflow read at eighteen points before any of this was written, and
 * it needs no account. Apple's Maps Server API is asked after it, when the
 * signing values are set (the same token as driving times,
 * `appleServerGet`), for whatever Nominatim left out. Each answer is turned
 * into `PlaceHints`, and one rule reads them all.
 *
 * Nominatim's terms are what shape the rest: an agent naming the application,
 * no more than a request a second, and its data credited where it is shown
 * (the picker says "Address from OpenStreetMap"). So an answer is kept a day
 * per point and language, rounded to about ten metres (no answer for five
 * minutes, since it may be a service that was down), requests from this
 * instance are spaced a second apart, and the client asks only once the map
 * has stopped. The router counts callers by address in Postgres.
 *
 * **Every way a service does not answer is the same answer: nothing.** The pin
 * still drops, and the form says the address is the shopper's to type. What
 * goes to the service is the point and the language, never who is asking.
 */
import { pinProblem, type Pin } from "../../../Shared/commerce/geo.js";
import { placeFromHints, matchArea, type Place, type PlaceAnswer, type PlaceHints, type PlaceSource } from "../../../Shared/commerce/placeParts.js";
import { siteOrigin } from "../core/email.js";
import { ENV } from "../core/env.js";
import { describeError } from "../core/describeError.js";
import { appleServerGet } from "./drivingTime.js";

export type { PlaceAnswer, PlaceSource };

const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";
const nominatimUrl = () => ENV.nominatimUrl.trim() || NOMINATIM;
const DEADLINE_MS = 3500;
/** Nominatim's own ceiling is one request a second. */
const SPACING_MS = 1100;
const ANSWER_TTL_MS = 24 * 60 * 60_000;
/** No answer may be a service that was down, so it is asked again sooner. */
const EMPTY_TTL_MS = 5 * 60_000;
const ANSWER_CEILING = 1000;

type Reply = { ok: boolean; status: number; json(): Promise<unknown> };
/** The seam the tests replace: no map service is reachable from where they run. */
export type Transport = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Reply>;

const defaultTransport: Transport = (url, init) => fetch(url, init);
let transport: Transport = defaultTransport;
let appleAsk: (path: string) => Promise<unknown | null> = path => appleServerGet(path);
let lastNominatim = 0;
let spacing = SPACING_MS;
const answers = new Map<string, { answer: PlaceAnswer | null; at: number }>();

/** For tests: stand-ins for Nominatim and Apple, and a clean slate. Null puts the real ones back. */
export function usePlaceServices(next: { nominatim?: Transport | null; apple?: ((path: string) => Promise<unknown | null>) | null; spacingMs?: number } | null): void {
  transport = next?.nominatim ?? defaultTransport;
  appleAsk = next?.apple ?? (path => appleServerGet(path));
  spacing = next?.spacingMs ?? SPACING_MS;
  lastNominatim = 0;
  answers.clear();
}

const point = (pin: Pin) => `${pin.lat.toFixed(4)},${pin.lng.toFixed(4)}`;
const words = (...values: unknown[]) => values.filter((value): value is string => typeof value === "string" && value.trim() !== "");

function agent(): string {
  const site = siteOrigin();
  return site ? `NetLet address lookup (+${site})` : "NetLet address lookup";
}

/** Nominatim's `address` object as hints: suburb and county are the area, neighbourhood the block. */
export function hintsFromNominatim(body: unknown): PlaceHints | null {
  const address = (body as { address?: Record<string, unknown> } | null)?.address;
  if (!address || typeof address !== "object") return null;
  if (typeof address.country_code === "string" && address.country_code.toLowerCase() !== "kw") return null;
  return {
    roads: words(address.road, address.pedestrian),
    blocks: words(address.neighbourhood, address.quarter, address.city_block, address.residential),
    areas: words(address.suburb, address.county, address.city_district, address.town, address.village, address.city),
    governorates: words(address["ISO3166-2-lvl4"], address.state),
    houses: words(address.house_number),
  };
}

/** Apple's `structuredAddress` as hints. */
export function hintsFromApple(body: unknown): PlaceHints | null {
  const result = (body as { results?: { structuredAddress?: Record<string, unknown>; countryCode?: unknown }[] } | null)?.results?.[0];
  const address = result?.structuredAddress;
  if (!address || typeof address !== "object") return null;
  if (typeof result?.countryCode === "string" && result.countryCode.toUpperCase() !== "KW") return null;
  const dependent = Array.isArray(address.dependentLocalities) ? address.dependentLocalities : [];
  return {
    roads: words(address.fullThoroughfare, address.thoroughfare),
    blocks: words(address.subLocality, ...dependent),
    areas: words(address.subLocality, ...dependent, address.locality),
    governorates: words(address.administrativeAreaCode ? `KW-${String(address.administrativeAreaCode)}` : null, address.administrativeArea),
    houses: words(address.subThoroughfare),
  };
}

async function nominatim(pin: Pin, locale: "en" | "ar"): Promise<PlaceHints | null> {
  const wait = lastNominatim + spacing - Date.now();
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastNominatim = Date.now();
  try {
    const url = `${nominatimUrl()}?format=jsonv2&lat=${pin.lat}&lon=${pin.lng}&zoom=18&addressdetails=1&accept-language=${locale}`;
    const reply = await transport(url, { headers: { "User-Agent": agent(), Accept: "application/json" }, signal: AbortSignal.timeout(DEADLINE_MS) });
    if (!reply.ok) {
      console.warn(`[maps] Nominatim answered ${reply.status}`);
      return null;
    }
    return hintsFromNominatim(await reply.json());
  } catch (error) {
    console.warn(`[maps] no address from Nominatim: ${describeError(error)}`);
    return null;
  }
}

async function apple(pin: Pin, locale: "en" | "ar"): Promise<PlaceHints | null> {
  const body = await appleAsk(`/reverseGeocode?loc=${point(pin)}&lang=${locale === "ar" ? "ar" : "en-US"}`);
  return body ? hintsFromApple(body) : null;
}

const merge = (first: PlaceHints, then: PlaceHints): PlaceHints => ({
  roads: [...first.roads, ...then.roads],
  blocks: [...first.blocks, ...then.blocks],
  areas: [...first.areas, ...then.areas],
  governorates: [...first.governorates, ...then.governorates],
  houses: [...first.houses, ...then.houses],
});

const complete = (place: Place | null) => Boolean(place?.parts.area && place.parts.block && place.parts.street);
const onList = (place: Place | null) => Boolean(place?.parts.area && matchArea(place.parts.area)?.en === place.parts.area);

/**
 * The address at `pin`, in `locale`'s words, or null.
 *
 * Nominatim in the page's language; on an English page whose area it spelled
 * in a way the list does not know, Nominatim again in Arabic, whose names the
 * list does; then Apple for anything still missing.
 */
export async function placeAt(pin: Pin, locale: "en" | "ar", now = Date.now()): Promise<PlaceAnswer | null> {
  if (pinProblem(pin)) return null;
  const key = `${point(pin)}|${locale}`;
  const kept = answers.get(key);
  if (kept && now - kept.at < (kept.answer ? ANSWER_TTL_MS : EMPTY_TTL_MS)) return kept.answer;

  let hints = await nominatim(pin, locale);
  let source: PlaceSource = "osm";
  let place = hints ? placeFromHints(hints) : null;

  if (hints && place?.parts.area && !onList(place) && locale === "en") {
    const arabic = await nominatim(pin, "ar");
    if (arabic) {
      /* The Arabic names go ahead only for the area, the one part the list
         decides; the street keeps the page's own words. */
      const matched = placeFromHints({ ...hints, areas: [...arabic.areas, ...hints.areas], blocks: [...hints.blocks, ...arabic.blocks] });
      if (onList(matched)) place = matched;
    }
  }

  if (!complete(place)) {
    const fromApple = await apple(pin, locale);
    if (fromApple) {
      hints = hints ? merge(hints, fromApple) : fromApple;
      const merged = placeFromHints(hints);
      if (merged && (!place || Object.keys(merged.parts).length > Object.keys(place.parts).length)) {
        if (!place) source = "apple";
        place = merged;
      }
    }
  }

  const answer = place ? { ...place, source } : null;
  if (answers.size >= ANSWER_CEILING) answers.delete(answers.keys().next().value!);
  answers.set(key, { answer, at: now });
  return answer;
}
