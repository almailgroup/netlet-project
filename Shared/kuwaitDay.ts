/**
 * A calendar day as Kuwait counts it.
 *
 * A date box speaks `yyyy-mm-dd` and nothing else, and `new Date("2026-10-20")`
 * is midnight *UTC* — three in the morning in Kuwait, on the day it names. So
 * a discount code set to end on the 20th stopped working at 3am on the 20th, a
 * gift card "valid until" a date was refused on that date, and a discount
 * permit recorded as expiring on a Tuesday hid the shop's savings from the
 * Tuesday morning. Somebody who types the last day means the whole of it.
 *
 * Kuwait keeps UTC+3 all year, with no daylight saving, so the offset is a
 * constant rather than a time-zone lookup.
 */
export const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** What a date box sends. */
export const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The last moment of a calendar day in Kuwait: "2026-10-20" → 2026-10-20T20:59:59.999Z. */
export function endOfKuwaitDay(day: string): Date {
  return new Date(Date.parse(`${day}T23:59:59.999+03:00`));
}

/** Which calendar day it is in Kuwait at a given moment, as `yyyy-mm-dd`. */
export function kuwaitDay(when: Date): string {
  return new Date(when.getTime() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}
