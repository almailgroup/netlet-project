/**
 * The seasons and the occasions, and which products are for them — the home
 * page's "Seasonal & occasion-based shopping", on the owner's word ("dedicated
 * sections for seasonal events and special occasions, such as Back to School,
 * Halloween, New Year, and other holidays").
 *
 * **The calendar is in code, like the departments and the areas**: an
 * occasion is a name in both languages (a dictionary key), the words a
 * store tags a product with for it, and a window — by the Gregorian
 * calendar for a fixed date, by the Umm al-Qura Hijri calendar for Ramadan
 * and the two Eids, which move through the year. A window is drawn as the
 * shopping for it happens, which starts before the day: the back-to-school
 * shelf is for August, not the first morning of term.
 *
 * **A store puts a product on an occasion by tagging it**, in its editor's
 * Tags box, with any of the occasion's words in either language or its slug
 * — "Back to School", "back-to-school", "العودة إلى المدارس" are one tag,
 * compared folded (`foldTag`). Nothing here chooses a product by its kind:
 * a shop deciding that every notebook is for school would be the shop
 * promising for a seller. No table and no desk, so an occasion with no
 * product tagged for it draws nothing, the shelves' rule; a desk where
 * NetLet curates a season by hand, with a picture and its own dates, is a
 * table to show the owner first.
 *
 * Pure and shared: the web's home page and department page and the app's
 * read the same table (`occasions.json`), so the two cannot disagree about
 * what Ramadan is called or when it is.
 */
import type { MessageKey } from "../i18n/dictionary.js";
import { KUWAIT_OFFSET_MS } from "../kuwaitDay.js";
import type { Product } from "./types.js";

/** A month and a day, in the window's own calendar. */
export type MonthDay = readonly [month: number, day: number];

export type OccasionWindow = {
  calendar: "gregorian" | "hijri";
  from: MonthDay;
  /** Earlier in the year than `from` means the window wraps the year's end. */
  to: MonthDay;
};

export type Occasion = {
  slug: string;
  /** Its name in both languages. */
  label: MessageKey;
  /** The words a store tags a product with for it; the slug always counts too. */
  tags: readonly string[];
  window: OccasionWindow;
};

/** In the order they are drawn when two fall on one day. */
export const OCCASIONS: readonly Occasion[] = [
  { slug: "ramadan", label: "occasion.ramadan", tags: ["ramadan", "رمضان", "رمضان كريم"], window: { calendar: "hijri", from: [8, 15], to: [9, 29] } },
  { slug: "eid-al-fitr", label: "occasion.eidAlFitr", tags: ["eid al fitr", "eid", "عيد الفطر", "العيد", "عيد"], window: { calendar: "hijri", from: [9, 20], to: [10, 5] } },
  { slug: "eid-al-adha", label: "occasion.eidAlAdha", tags: ["eid al adha", "eid", "عيد الأضحى", "العيد", "عيد"], window: { calendar: "hijri", from: [12, 1], to: [12, 13] } },
  { slug: "national-day", label: "occasion.nationalDay", tags: ["national day", "liberation day", "hala february", "العيد الوطني", "عيد التحرير", "هلا فبراير"], window: { calendar: "gregorian", from: [2, 10], to: [2, 26] } },
  { slug: "mothers-day", label: "occasion.mothersDay", tags: ["mother's day", "mothers day", "عيد الأم"], window: { calendar: "gregorian", from: [3, 7], to: [3, 21] } },
  { slug: "summer", label: "occasion.summer", tags: ["summer", "الصيف", "صيف"], window: { calendar: "gregorian", from: [6, 1], to: [8, 10] } },
  { slug: "back-to-school", label: "occasion.backToSchool", tags: ["back to school", "school", "العودة إلى المدارس", "العودة للمدارس", "المدرسة", "مدرسة"], window: { calendar: "gregorian", from: [8, 11], to: [9, 20] } },
  { slug: "halloween", label: "occasion.halloween", tags: ["halloween", "هالوين"], window: { calendar: "gregorian", from: [10, 15], to: [10, 31] } },
  { slug: "winter", label: "occasion.winter", tags: ["winter", "الشتاء", "شتاء"], window: { calendar: "gregorian", from: [11, 15], to: [1, 31] } },
  { slug: "new-year", label: "occasion.newYear", tags: ["new year", "رأس السنة", "السنة الجديدة"], window: { calendar: "gregorian", from: [12, 15], to: [1, 7] } },
];

/**
 * A tag as a store might type it, reduced to what it means: lower case, the
 * spaces and punctuation gone, the Arabic letters keyboards disagree on made
 * one and the vowel marks dropped — the search's folding, for a word that is
 * compared whole rather than searched.
 */
export function foldTag(tag: string): string {
  return tag
    .normalize("NFC")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Every folded word that puts a product on the occasion. */
export function occasionKeys(occasion: Occasion): Set<string> {
  return new Set([occasion.slug, ...occasion.tags].map(foldTag));
}

export function isOccasionProduct(product: Pick<Product, "tags">, occasion: Occasion): boolean {
  const keys = occasionKeys(occasion);
  return product.tags.some(tag => keys.has(foldTag(tag)));
}

/** The products tagged for the occasion, in the order they came. */
export function productsForOccasion<T extends Pick<Product, "tags">>(products: T[], occasion: Occasion): T[] {
  const keys = occasionKeys(occasion);
  return products.filter(product => product.tags.some(tag => keys.has(foldTag(tag))));
}

export function occasionFromSlug(slug: string | null | undefined): Occasion | null {
  return slug ? OCCASIONS.find(occasion => occasion.slug === slug) ?? null : null;
}

const HIJRI = "islamic-umalqura";
let hijriFormat: Intl.DateTimeFormat | null | undefined;

/**
 * The Umm al-Qura calendar, the one Kuwait's own dates are read by (the
 * invoice prints it). A browser that cannot keep it answers the Gregorian
 * month and day under the same request, which would put Ramadan in
 * September — so the formatter is trusted only when it says it is Hijri,
 * and otherwise a Hijri window is never on.
 */
function hijriFormatter(): Intl.DateTimeFormat | null {
  if (hijriFormat !== undefined) return hijriFormat;
  try {
    const format = new Intl.DateTimeFormat(`en-u-ca-${HIJRI}-nu-latn`, { timeZone: "Asia/Kuwait", month: "numeric", day: "numeric" });
    hijriFormat = format.resolvedOptions().calendar === HIJRI ? format : null;
  } catch {
    hijriFormat = null;
  }
  return hijriFormat;
}

/** The Hijri month and day of a moment, on Kuwait's day; null where the calendar is not kept. */
export function hijriMonthDay(date: Date): MonthDay | null {
  const format = hijriFormatter();
  if (!format) return null;
  const parts = format.formatToParts(date);
  const month = Number(parts.find(part => part.type === "month")?.value);
  const day = Number(parts.find(part => part.type === "day")?.value);
  return Number.isInteger(month) && Number.isInteger(day) ? [month, day] : null;
}

/** The Gregorian month and day of a moment, on Kuwait's day (`kuwaitDay`'s rule). */
export function kuwaitMonthDay(date: Date): MonthDay {
  const shifted = new Date(date.getTime() + KUWAIT_OFFSET_MS);
  return [shifted.getUTCMonth() + 1, shifted.getUTCDate()];
}

/** Whether a month and day fall inside a window, which may wrap the year's end. */
export function inWindow(at: MonthDay, window: Pick<OccasionWindow, "from" | "to">): boolean {
  const key = ([month, day]: MonthDay) => month * 100 + day;
  const here = key(at);
  const from = key(window.from);
  const to = key(window.to);
  return from <= to ? here >= from && here <= to : here >= from || here <= to;
}

export function occasionOn(occasion: Occasion, date: Date): boolean {
  const at = occasion.window.calendar === "hijri" ? hijriMonthDay(date) : kuwaitMonthDay(date);
  return at !== null && inWindow(at, occasion.window);
}

/** The occasions whose shopping is on at this moment, in the table's order. */
export function occasionsOn(date = new Date()): Occasion[] {
  return OCCASIONS.filter(occasion => occasionOn(occasion, date));
}
