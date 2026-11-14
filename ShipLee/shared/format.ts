/**
 * Dates and money as each page writes them.
 *
 * Every date is Kuwait's, whoever is reading: a parcel's day is a Kuwaiti day,
 * and a page formatting in the browser's own zone would put an evening update
 * on the wrong date for anybody abroad. Digits are Latin on the Arabic page
 * too (`nu-latn`), as NetLet's are, so a time and a tracking number read the
 * same way beside each other.
 */
import type { Lang } from "./i18n.js";
import { KUWAIT_ZONE, kuwaitDay } from "./kuwait.js";

const LOCALE: Record<Lang, string> = { en: "en-GB", ar: "ar-KW-u-nu-latn" };

/** "Mon 16 Nov" — a day written by itself, from yyyy-mm-dd. */
export function formatDay(day: string, lang: Lang): string {
  const date = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(date);
}

/** "14 November 2026" — the day an instant fell on in Kuwait. */
export function formatDate(at: string | Date, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: KUWAIT_ZONE }).format(new Date(at));
}

/** "15:20" in Kuwait. */
export function formatTime(at: string | Date, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: KUWAIT_ZONE }).format(new Date(at));
}

/** "14 November 2026, 15:20" in Kuwait. */
export function formatDateTime(at: string | Date, lang: Lang): string {
  return `${formatDate(at, lang)}${lang === "ar" ? "، " : ", "}${formatTime(at, lang)}`;
}

/** The Kuwaiti day an instant fell on, yyyy-mm-dd. */
export function dayOf(at: string | Date): string {
  return kuwaitDay(new Date(at));
}

/** The day before yyyy-mm-dd. */
export function dayBefore(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** The day after yyyy-mm-dd. */
export function dayAfter(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** "KWD 12.500" or "12.500 د.ك." — the dinar always to three places. */
export function formatMoney(fils: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency: "KWD", minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(fils / 1000);
}
