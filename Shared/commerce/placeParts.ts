/**
 * Reading a Kuwaiti address out of what a map service says about a pin: the
 * area, the block, the street (and its avenue), and the house when the pin is
 * on one.
 *
 * Dropping a pin fills the boxes a driver needs (`kuwaitAddress.ts`), so the
 * shopper checks an address rather than typing one. A map service answers in
 * its own words — OpenStreetMap's "Salmiya - Block 5" and "Street 3 Lane 1",
 * Apple's sub-locality, "قطعة 5" on the Arabic page — so each provider's
 * answer is handed over as `PlaceHints`, its candidate words by kind, best
 * first, and this decides what they mean. Pure and shared, because the form
 * fills from it and the server answers with it, and both must agree on what
 * "Block 5" is.
 *
 * ## The area is NetLet's list, or it is typed
 *
 * An area on the list is stored by its English name, a stable key. A service
 * spells it its own way — "Mishrif", "Hawally", "Eqaila", "Al-Qurain",
 * "Abdullah Mubarak Al-Sabah", "المنطقة الوسطي" — so names are compared folded:
 * the article and the "governorate" or "area" words gone, Arabic letters that
 * keyboards disagree on made one, and a Latin name allowed a letter or two of
 * spelling (`maxSlip`), the closest winning and a tie meaning nothing.
 * Arabic is compared whole or contained, never fuzzily: its spellings agree.
 * An area that matches nothing is kept as the service wrote it, which is what
 * "Another area" holds.
 *
 * ## Numbers, never words, for block and street
 *
 * "Block 5" is a 5 and "Street 52" a 52, because the form's own words put
 * "Block" and "Street" back (`composeAddressLine`); a named street keeps its
 * name without the word "Street". A road named only by number elsewhere —
 * "Road 3", "طريق 3" — is kept whole, since "Street 3" would be a different
 * road.
 */
import { AREAS, PART_MAX, latinDigits, type AddressParts, type PartKey } from "./kuwaitAddress.js";
import { kuwaitDeliveryZones } from "../customer.js";

/** A map service's candidate words for one point, by kind, best first. */
export type PlaceHints = {
  roads: string[];
  blocks: string[];
  areas: string[];
  /** Names ("Hawalli Governorate", "محافظة حولي") or ISO codes ("KW-HA"). */
  governorates: string[];
  /** Only when the point is on a building with a number. */
  houses: string[];
};

/** The parts a pin can fill. */
export const PIN_PARTS = ["area", "block", "street", "avenue", "building"] as const satisfies readonly PartKey[];
export type PinPart = (typeof PIN_PARTS)[number];

export type Place = {
  parts: Partial<Record<PinPart, string>>;
  /** A governorate id from `Shared/customer.ts`, or null. */
  governorate: string | null;
};

/** Which service read it — OpenStreetMap asks to be credited where its data is shown. */
export type PlaceSource = "osm" | "apple";
/** What `maps.placeAt` answers. */
export type PlaceAnswer = Place & { source: PlaceSource };

/** ISO 3166-2 for Kuwait's governorates, which OpenStreetMap carries on every answer. */
const ISO_GOVERNORATES: Record<string, string> = {
  "KW-KU": "capital",
  "KW-HA": "hawalli",
  "KW-FA": "farwaniya",
  "KW-AH": "ahmadi",
  "KW-JA": "jahra",
  "KW-MU": "mubarak-al-kabeer",
};

/** Other names the governorates go by: the capital is "Al Asimah" and "Kuwait". */
const GOVERNORATE_ALIASES: Record<string, string[]> = {
  capital: ["asimah", "alasimah", "kuwaitcity", "عاصمه"],
};

const ARABIC = /[؀-ۿ]/;

/** Latin words that say what kind of place a name is, not which. */
const LATIN_NOISE = new Set(["al", "el", "as", "ar", "ad", "an", "ash", "az", "at", "governorate", "province", "area", "district", "suburb", "city", "block", "blk", "the"]);
/** Arabic words of the same kind, after folding. */
const ARABIC_NOISE = new Set(["منطقه", "المنطقه", "ضاحيه", "محافظه", "قطعه"]);

/** A Latin name as letters alone, with the article and the "area" words gone. */
export function foldLatin(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .split(/[^a-z]+/)
    .filter(word => word && !LATIN_NOISE.has(word))
    .join("");
}

/** An Arabic name with its marks, its article and the letters keyboards disagree on folded. */
export function foldArabic(name: string): string {
  return name
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .split(/[^ء-ي]+/)
    .filter(word => word && !ARABIC_NOISE.has(word))
    .map(word => (word.startsWith("ال") && word.length > 3 ? word.slice(2) : word))
    .join("");
}

/** Edits between two words, a swapped pair counting once. */
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** How far a Latin spelling may stray: none for a short name, one for most, two for a long one. */
export function maxSlip(length: number): number {
  if (length < 5) return 0;
  return length < 8 ? 1 : 2;
}

/**
 * One name inside another, for a name that carries a word more ("Abdullah
 * Mubarak Al-Sabah"). Only when it is most of it, so "Hawalli" is not "Maidan
 * Hawalli", and only for a whole word more: a letter or two is a spelling,
 * which the closest-match tier decides, ties and all.
 */
function contained(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 5 && long.length - short.length >= 3 && long.includes(short) && short.length / long.length >= 0.6;
}

type AreaEntry = { en: string; ar: string; governorate: string };

const ALL_AREAS: AreaEntry[] = Object.entries(AREAS).flatMap(([governorate, list]) =>
  list.map(entry => ({ ...entry, governorate })),
);

/**
 * The area on NetLet's list that a service's name means, or null.
 *
 * Exact first, then one contained in the other, then — Latin only — the
 * closest within a slip or two; a governorate already known is searched
 * first, so a name two governorates share lands in the right one. A tie at
 * the closest distance is no answer: guessing between two real places is how
 * a parcel goes to the wrong one.
 */
export function matchArea(name: string, governorate?: string | null): AreaEntry | null {
  const arabic = ARABIC.test(name);
  const folded = arabic ? foldArabic(name) : foldLatin(name);
  if (!folded) return null;
  const pools = governorate ? [ALL_AREAS.filter(entry => entry.governorate === governorate), ALL_AREAS] : [ALL_AREAS];
  for (const pool of pools) {
    const keys = pool.map(entry => ({ entry, key: arabic ? foldArabic(entry.ar) : foldLatin(entry.en) }));
    const exact = keys.find(item => item.key === folded);
    if (exact) return exact.entry;
    const within = keys.filter(item => contained(item.key, folded));
    if (within.length === 1) return within[0].entry;
    if (arabic) continue;
    const slip = maxSlip(folded.length);
    if (slip === 0) continue;
    let best: AreaEntry | null = null;
    let bestDistance = Infinity;
    let tied = false;
    for (const item of keys) {
      const gap = distance(item.key, folded);
      if (gap > slip) continue;
      if (gap < bestDistance) { best = item.entry; bestDistance = gap; tied = false; }
      else if (gap === bestDistance) tied = true;
    }
    if (best && !tied) return best;
  }
  return null;
}

/** A governorate id from a service's name or ISO code, or null. */
export function matchGovernorate(name: string): string | null {
  const code = name.trim().toUpperCase();
  if (ISO_GOVERNORATES[code]) return ISO_GOVERNORATES[code];
  const arabic = ARABIC.test(name);
  const folded = arabic ? foldArabic(name) : foldLatin(name);
  if (!folded) return null;
  for (const zone of kuwaitDeliveryZones) {
    const names = arabic ? [zone.labelAr] : [zone.label, zone.id];
    const keys = names.map(entry => (arabic ? foldArabic(entry) : foldLatin(entry)));
    keys.push(...(GOVERNORATE_ALIASES[zone.id] ?? []).filter(alias => ARABIC.test(alias) === arabic));
    if (keys.some(key => key === folded || (!arabic && key.length >= 5 && distance(key, folded) <= maxSlip(folded.length)))) return zone.id;
  }
  return null;
}

const NUMBER = "([0-9٠-٩]{1,4}[A-Za-z]?)";
const BLOCK = new RegExp(`(?:\\bblock|\\bblk|قطعة|قطعه)\\s*(?:no\\.?|number|رقم)?\\s*[:#.\\-]?\\s*${NUMBER}`, "i");
const AVENUE = new RegExp(`(?:\\blane|\\bavenue|\\bave\\.?|\\bjadd?ah?|جادة|جاده)\\s*(?:no\\.?|رقم)?\\s*${NUMBER}`, "i");
const STREET_NUMBER = new RegExp(`^(?:street|st\\.?|شارع)\\s*(?:no\\.?|رقم)?\\s*${NUMBER}$`, "i");

/** The block's number from "Salmiya - Block 5", "Block 2" or "قطعة 5", or null. */
export function blockOf(text: string): string | null {
  const found = BLOCK.exec(text);
  if (found) return latinDigits(found[1]).toUpperCase();
  const bare = latinDigits(text.trim());
  return /^\d{1,3}$/.test(bare) ? bare : null;
}

/** What is left of "Salmiya - Block 5" once the block is taken out: the area's name. */
function areaBesideBlock(text: string): string | null {
  const rest = text.replace(BLOCK, "").replace(/[\s\-–—،,]+$/u, "").replace(/^[\s\-–—،,]+/u, "").trim();
  return rest || null;
}

/**
 * The street and its avenue from a road's name.
 *
 * "Street 3 Lane 1" and "شارع 3 جادة 1" are street 3, avenue 1; "Street 52" is
 * 52; "Hamad Al-Mubarak Street" and "شارع حمد المبارك" are the name without
 * the word; "Road 3" is kept whole; "Lane 4" alone is an avenue and no street.
 */
export function streetOf(text: string): { street?: string; avenue?: string } {
  let rest = latinDigits(text).replace(/\s+/g, " ").trim();
  const result: { street?: string; avenue?: string } = {};
  const lane = AVENUE.exec(rest);
  if (lane) {
    result.avenue = lane[1].toUpperCase();
    rest = (rest.slice(0, lane.index) + rest.slice(lane.index + lane[0].length)).replace(/\s+/g, " ").replace(/[\s,،\-]+$/u, "").trim();
  }
  if (!rest) return result;
  const numbered = STREET_NUMBER.exec(rest);
  if (numbered) {
    result.street = numbered[1].toUpperCase();
    return result;
  }
  const named = rest
    .replace(/^(?:شارع)\s+/u, "")
    .replace(/^(?:street|st\.?)\s+(?=\D)/i, "")
    .replace(/\s+(?:street|st\.?)$/i, "")
    .trim();
  if (named) result.street = named;
  return result;
}

const clip = (key: PinPart, value: string) => value.slice(0, PART_MAX[key]).trim();

/**
 * What the hints say the address is. Null when they say nothing a form can
 * use — a pin in the sea, a desert with no names.
 */
export function placeFromHints(hints: PlaceHints): Place | null {
  const parts: Place["parts"] = {};

  let governorate: string | null = null;
  for (const name of hints.governorates) {
    governorate = matchGovernorate(name);
    if (governorate) break;
  }

  for (const text of hints.blocks) {
    const block = blockOf(text);
    if (block) { parts.block = clip("block", block); break; }
  }

  /* The area: the first name the list knows, else the first name given. A
     block's own label names its area too ("Salmiya - Block 5"). */
  const names = [...hints.areas, ...hints.blocks.map(areaBesideBlock).filter((name): name is string => Boolean(name))]
    .map(name => name.trim())
    .filter(name => name && !blockOf(name));
  let area: AreaEntry | null = null;
  for (const name of names) {
    area = matchArea(name, governorate);
    if (area) break;
  }
  if (area) {
    parts.area = area.en;
    governorate = area.governorate;
  } else if (names[0]) {
    parts.area = clip("area", names[0]);
  }

  for (const road of hints.roads) {
    const found = streetOf(road);
    if (found.street) parts.street = clip("street", found.street);
    if (found.avenue) parts.avenue = clip("avenue", found.avenue);
    if (found.street || found.avenue) break;
  }

  for (const house of hints.houses) {
    const value = latinDigits(house).replace(/\s+/g, "").toUpperCase();
    if (/^[0-9]{1,5}[A-Z]?(?:\/[0-9]{1,4})?$/.test(value)) { parts.building = clip("building", value); break; }
  }

  if (!Object.keys(parts).length && !governorate) return null;
  return { parts, governorate };
}

/** Two values the same for a form's purposes: digits folded, case and spacing ignored. */
function same(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (value: string | null | undefined) => latinDigits(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return norm(a) === norm(b);
}

export type PlaceFill = {
  parts: AddressParts;
  governorate: string | null;
  /** The parts the pin wrote, so the form can say which and a later pin may write them again. */
  filled: PinPart[];
  /** Parts the shopper typed that the pin disagrees with, left as typed. */
  conflicts: PinPart[];
};

/**
 * The form's parts after a pin, given which parts an earlier pin wrote.
 *
 * **A pin writes what is empty or was the pin's**, and never over what the
 * shopper typed: a new address dropped on the map fills itself, and somebody
 * nudging the pin of an address they typed by hand keeps their spelling. Where
 * the pin disagrees with a typed part, it is a `conflict` the form names, with
 * a press that takes the pin's (`force`). A part an earlier pin wrote and this
 * one has no answer for is emptied, or a pin moved off a building would leave
 * the last building's number behind.
 *
 * The governorate follows an area the pin wrote, since the area decides it;
 * otherwise it is filled only when none was chosen.
 */
export function fillFromPlace(
  current: AddressParts,
  governorate: string | null | undefined,
  place: Place,
  byPin: readonly PinPart[],
  force = false,
): PlaceFill {
  const parts: AddressParts = { ...current };
  const filled: PinPart[] = [];
  const conflicts: PinPart[] = [];
  for (const key of PIN_PARTS) {
    const value = place.parts[key];
    const typed = (current[key] ?? "").trim();
    const mine = byPin.includes(key);
    if (!value) {
      if (mine) parts[key] = "";
      continue;
    }
    if (!typed || mine || force || same(typed, value)) {
      parts[key] = value;
      filled.push(key);
    } else {
      conflicts.push(key);
    }
  }
  const zone = governorate?.trim() || null;
  const areaFromPin = filled.includes("area");
  const nextGovernorate = place.governorate && (areaFromPin || !zone || force) ? place.governorate : zone;
  return { parts, governorate: nextGovernorate, filled, conflicts };
}
