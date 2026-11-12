/**
 * The occasions NetLet curates by hand — on the owner's word ("a way for you
 * to curate an occasion by hand in the admin portal: your own banner picture,
 * your own dates, and products you pick rather than ones stores tag").
 *
 * `occasions.ts` is the calendar in code and the stores' tags; this is the
 * desk over it. An occasion here is a row NetLet wrote: a name in both
 * languages, an address, an optional banner picture, the days it runs, the
 * products chosen for it in the order chosen, and whether what the stores
 * tagged for it joins them.
 *
 * ## One of NetLet's own, or one of the calendar's taken over
 *
 * An occasion whose address is a calendar occasion's (`back-to-school`,
 * `ramadan`, `winter`…) takes that occasion over once it is published: its
 * names, picture, products and days stand in the calendar's place. With no
 * days of its own it keeps the calendar's window, so Ramadan still moves
 * through the year by itself; with days, those days are when it runs, and
 * the calendar's are not. `hidden` switches a calendar occasion off — nothing
 * is drawn for it — and means nothing for one of NetLet's own. A draft
 * changes nothing a shopper sees: the calendar's own still shows.
 *
 * ## Days are Kuwait's
 *
 * `starts_on` and `ends_on` are calendar days in Kuwait, both inclusive, and
 * whether an occasion is on is read from today's Kuwaiti day, so nothing has
 * to run for one to start or end.
 *
 * Pure and shared: the form refuses what the server refuses, and the home
 * page on the web and in the app merge the server's answer by one rule.
 */
import type { MessageKey } from "../i18n/dictionary.js";
import { DAY_ONLY, kuwaitDay } from "../kuwaitDay.js";
import { contactFindings } from "./contactFilter.js";
import { isMediaPath } from "./media.js";
import { foldTag, occasionFromSlug, occasionKeys, occasionOn } from "./occasions.js";

export const OCCASION_STATUSES = ["draft", "published", "hidden"] as const;
export type OccasionStatus = (typeof OCCASION_STATUSES)[number];

/** The columns' widths. */
export const OCCASION_TITLE_MAX = 80;
export const OCCASION_SLUG_MAX = 40;
/** The most products chosen for one occasion: its page is a shelf, not a department. */
export const MAX_OCCASION_PRODUCTS = 60;
/** The longest one run: a year, since a longer one is not an occasion. */
export const MAX_OCCASION_DAYS = 366;
/** How many occasions NetLet may keep, drafts included. */
export const MAX_CURATED_OCCASIONS = 200;
/** How many of NetLet's occasions one answer to the home page carries; the page draws the first that clear its floor. */
export const MAX_LIVE_OCCASIONS = 6;

/** What an administrator writes. */
export type OccasionContent = {
  slug: string;
  title: string;
  titleAr: string;
  /** One of NetLet's own uploads, 3:1, or none. */
  imageUrl: string | null;
  /** Kuwaiti days, both inclusive; both or neither. */
  startsOn: string | null;
  endsOn: string | null;
  /** Whether what the stores tagged for it follows the products chosen. */
  includeTagged: boolean;
};

export type CuratedOccasion = OccasionContent & { status: OccasionStatus };

/** What a shopper's page is told about one of NetLet's occasions. */
export type PublicOccasion = Pick<OccasionContent, "slug" | "title" | "titleAr" | "imageUrl" | "includeTagged">;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** An address: lower-case letters, digits and single hyphens, as `?occasion=` reads it. */
export function isOccasionSlug(value: string): boolean {
  return value.length > 0 && value.length <= OCCASION_SLUG_MAX && SLUG.test(value);
}

/** The address a name would have: "White Friday 2026" → `white-friday-2026`. */
export function occasionSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, OCCASION_SLUG_MAX)
    .replace(/-+$/, "");
  return slug || "occasion";
}

/** Whether an address is one of the calendar's own occasions. */
export function isCalendarSlug(slug: string): boolean {
  return occasionFromSlug(slug) !== null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A `yyyy-mm-dd` day as a count of days, or null when it is not a real day. */
function dayNumber(day: string | null | undefined): number | null {
  if (!day || !DAY_ONLY.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const at = Date.UTC(year, month - 1, date);
  /* 2026-02-30 parses, as the second of March: a real day reads back as itself. */
  return new Date(at).toISOString().slice(0, 10) === day ? Math.round(at / DAY_MS) : null;
}

export type OccasionField = "title" | "titleAr" | "slug" | "startsOn" | "endsOn" | "imageUrl";
export type OccasionProblems = Partial<Record<OccasionField, MessageKey>>;

/** The fields in the order the form draws them, so the first problem is the first box. */
export const OCCASION_FIELDS: readonly OccasionField[] = ["title", "titleAr", "slug", "imageUrl", "startsOn", "endsOn"];

/**
 * What is wrong with an occasion as written, by the box it is wrong in; empty
 * when it can be saved. Every save is held to it, a draft's too: an occasion
 * is two names, an address and two days, and nothing is gained by keeping one
 * that has none of them.
 */
export function occasionProblems(content: OccasionContent): OccasionProblems {
  const problems: OccasionProblems = {};
  const title = content.title.trim();
  const titleAr = content.titleAr.trim();
  if (!title) problems.title = "occasions.needTitle";
  else if (title.length > OCCASION_TITLE_MAX) problems.title = "occasions.titleTooLong";
  else if (contactFindings(title).length > 0) problems.title = "occasions.contactDetails";
  if (!titleAr) problems.titleAr = "occasions.needTitleAr";
  else if (titleAr.length > OCCASION_TITLE_MAX) problems.titleAr = "occasions.titleTooLong";
  else if (contactFindings(titleAr).length > 0) problems.titleAr = "occasions.contactDetails";
  if (!isOccasionSlug(content.slug)) problems.slug = "occasions.badSlug";
  if (content.imageUrl !== null && !isMediaPath(content.imageUrl)) problems.imageUrl = "occasions.badPicture";

  const hasStart = Boolean(content.startsOn);
  const hasEnd = Boolean(content.endsOn);
  if (!hasStart && !hasEnd) {
    /* Only an occasion the calendar knows can leave its days to the calendar. */
    if (!isCalendarSlug(content.slug)) problems.startsOn = "occasions.needDates";
    return problems;
  }
  const from = dayNumber(content.startsOn);
  const to = dayNumber(content.endsOn);
  if (!hasStart) problems.startsOn = "occasions.needBothDates";
  else if (from === null) problems.startsOn = "occasions.badDate";
  if (!hasEnd) problems.endsOn = "occasions.needBothDates";
  else if (to === null) problems.endsOn = "occasions.badDate";
  if (from !== null && to !== null) {
    if (to < from) problems.endsOn = "occasions.endsBeforeStart";
    else if (to - from + 1 > MAX_OCCASION_DAYS) problems.endsOn = "occasions.tooLong";
  }
  return problems;
}

/** The first problem in the form's own order, or null. */
export function firstOccasionProblem(problems: OccasionProblems): { field: OccasionField; problem: MessageKey } | null {
  for (const field of OCCASION_FIELDS) {
    const problem = problems[field];
    if (problem) return { field, problem };
  }
  return null;
}

/** Whether a status makes sense for an address: only a calendar occasion can be switched off. */
export function statusAllowed(slug: string, status: OccasionStatus): boolean {
  return status !== "hidden" || isCalendarSlug(slug);
}

/** Where an occasion stands today. */
export type OccasionSeason =
  /** Running. `daysLeft` counts today as zero; null when it keeps the calendar's window. */
  | { state: "on"; daysLeft: number | null }
  /** Its first day is `days` days away. */
  | { state: "upcoming"; days: number }
  /** Its last day was `days` days ago. */
  | { state: "ended"; days: number }
  /** It keeps the calendar's window, which is not open today. */
  | { state: "outOfSeason" };

/** Whether an occasion's days include today, by its own days or the calendar's. */
export function occasionSeason(occasion: Pick<OccasionContent, "slug" | "startsOn" | "endsOn">, now: Date): OccasionSeason {
  const from = dayNumber(occasion.startsOn);
  const to = dayNumber(occasion.endsOn);
  if (from === null || to === null) {
    const calendar = occasionFromSlug(occasion.slug);
    return calendar && occasionOn(calendar, now) ? { state: "on", daysLeft: null } : { state: "outOfSeason" };
  }
  const today = dayNumber(kuwaitDay(now)) ?? 0;
  if (today < from) return { state: "upcoming", days: from - today };
  if (today > to) return { state: "ended", days: today - to };
  return { state: "on", daysLeft: to - today };
}

/** NetLet's occasions a shopper is shown today: published and running, in the order given. */
export function curatedOn<T extends CuratedOccasion>(rows: readonly T[], now: Date): T[] {
  return rows.filter(row => row.status === "published" && occasionSeason(row, now).state === "on");
}

/**
 * The calendar occasions the calendar itself must not draw: NetLet's
 * published row stands in its place — running or not, its days being the
 * days now — or the occasion is switched off.
 */
export function replacedSlugs(rows: readonly Pick<CuratedOccasion, "slug" | "status">[]): string[] {
  return rows.filter(row => row.status !== "draft" && isCalendarSlug(row.slug)).map(row => row.slug);
}

/**
 * The folded words that put a store's product on one of NetLet's occasions:
 * its address and both its names, and the calendar occasion's own words when
 * it has taken one over — so "back to school" still counts for a Back to
 * school NetLet renamed.
 */
export function curatedKeys(occasion: Pick<PublicOccasion, "slug" | "title" | "titleAr">): Set<string> {
  const calendar = occasionFromSlug(occasion.slug);
  const keys = calendar ? occasionKeys(calendar) : new Set<string>();
  for (const word of [occasion.slug, occasion.title, occasion.titleAr]) {
    const folded = foldTag(word);
    if (folded) keys.add(folded);
  }
  return keys;
}

/**
 * What one of NetLet's occasions shows: the products chosen for it, in the
 * order chosen, then — where it takes them — what the stores tagged for it,
 * in the order they came, each once.
 */
export function curatedProducts<T extends { id: string; tags: readonly string[] }>(
  occasion: PublicOccasion,
  chosen: readonly T[],
  catalog: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const product of chosen) {
    if (seen.has(product.id)) continue;
    seen.add(product.id);
    out.push(product);
  }
  if (!occasion.includeTagged) return out;
  const keys = curatedKeys(occasion);
  for (const product of catalog) {
    if (seen.has(product.id) || !product.tags.some(tag => keys.has(foldTag(tag)))) continue;
    seen.add(product.id);
    out.push(product);
  }
  return out;
}

/** An occasion's name in the page's language. */
export function occasionName(occasion: Pick<PublicOccasion, "title" | "titleAr">, isArabic: boolean): string {
  return (isArabic && occasion.titleAr.trim()) || occasion.title;
}
