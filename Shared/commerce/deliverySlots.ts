/**
 * When a store's parcel may come: a day and a part of the day the shopper
 * prefers.
 *
 * On the owner's word (migration 0085): each store's delivery in the bag says
 * where it is going, what it costs, Standard or Express, and — for a store
 * that has said how soon it ships — a day and a time of day. Pure, for the
 * reason the fee is: it is a promise a shopper decides on, and a promise you
 * can only check by placing an order is one nobody checks.
 *
 * ## Five rules
 *
 * **The days start at the store's own earliest day.** A band of "2 to 4 days"
 * cannot be delivered tomorrow, so the first day offered is the band's first
 * (`arrivalFor(...).from`), and the store's slowest line decides — a parcel
 * comes when its last thing is ready.
 *
 * **Seven working days, the weekend skipped.** Friday and Saturday are not
 * offered, as `addBusinessDays` already counts them, and a week is as far
 * ahead as anybody plans a doorstep.
 *
 * **A time of day is a preference, never a slot booked.** NetLet holds no
 * driver's calendar, so a window is what the shopper would like and the store
 * and the driver see it as that; the page says "preferred". Three windows on
 * Kuwait's clock: the morning 9 to 12, the afternoon 12 to 4, the evening 4
 * to 9. A window today is offered only while its start is still ahead.
 *
 * **A store that has said nothing offers nothing.** No band, a band of made to
 * order, or a line that will be a pre-order (whose promise is its release
 * date): no day and no time, because any day offered would be NetLet
 * promising for the store. An Express parcel takes the store's fast band, and
 * a store with no fast band offers no day for it either.
 *
 * **A choice that is no longer offered is said, never moved.** A day chosen on
 * Sunday for Monday is gone on Tuesday; the bag says so beside the store and
 * the order will not be placed with it, rather than quietly picking another
 * day the shopper never chose.
 */
import { kuwaitDay, KUWAIT_OFFSET_MS } from "../kuwaitDay.js";
import { arrivalFor, isDeliverySpeed, isWeekend, slowestSpeed, type DeliverySpeed } from "./deliverySpeed.js";

export const DELIVERY_WINDOWS = ["morning", "afternoon", "evening"] as const;
export type DeliveryWindow = (typeof DELIVERY_WINDOWS)[number];

/** Each window on Kuwait's clock: from its first hour, up to its last. */
export const WINDOW_HOURS: Record<DeliveryWindow, { from: number; to: number }> = {
  morning: { from: 9, to: 12 },
  afternoon: { from: 12, to: 16 },
  evening: { from: 16, to: 21 },
};

/** How many working days are offered, from the store's earliest. */
export const SLOT_DAYS = 7;

export type SlotDay = { date: string; windows: DeliveryWindow[] };
export type DeliverySlot = { date: string; window: DeliveryWindow };

export function isDeliveryWindow(value: unknown): value is DeliveryWindow {
  return typeof value === "string" && (DELIVERY_WINDOWS as readonly string[]).includes(value);
}

/** Kuwait's hour now, with the minutes as a fraction: 9.5 is half past nine. */
function kuwaitHour(now: Date): number {
  const local = new Date(now.getTime() + KUWAIT_OFFSET_MS);
  return local.getUTCHours() + local.getUTCMinutes() / 60;
}

/**
 * The days a parcel at this band may be asked for, each with the windows still
 * open on it. Empty for no band, a band with no window (made to order), or a
 * day of the week that cannot be reached.
 *
 * A day whose every window has started (today, late) is left out and the next
 * working day takes its place, so there are always `SLOT_DAYS` to choose from.
 */
export function slotDays(speed: DeliverySpeed | null, now: Date = new Date()): SlotDay[] {
  if (!speed) return [];
  const arrival = arrivalFor(speed, now);
  if (!arrival.from) return [];
  const today = kuwaitDay(now);
  const hour = kuwaitHour(now);
  /* The band's first day, held as that Kuwaiti day's UTC midnight. */
  const day = new Date(arrival.from.getTime());
  const days: SlotDay[] = [];
  /* A guard, not a rule: seven working days are never more than ten. */
  for (let step = 0; days.length < SLOT_DAYS && step < 21; step += 1) {
    if (!isWeekend(day)) {
      const date = day.toISOString().slice(0, 10);
      const windows = date === today
        ? DELIVERY_WINDOWS.filter(window => WINDOW_HOURS[window].from > hour)
        : date > today ? [...DELIVERY_WINDOWS] : [];
      if (windows.length) days.push({ date, windows });
    }
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return days;
}

/** One line of a store's parcel, as far as its day is concerned. */
export type SlotLine = {
  /** The trip it rides: Express takes the store's fast band. */
  choice: "regular" | "fast";
  /** The regular trip's band for this line, or null (no band, or a pre-order). */
  speed: string | null;
  /** The store's fast band, or null when it has none. */
  fastSpeed: string | null;
};

/**
 * The band a store's day is counted from: the slowest of its lines, each by
 * the trip it rides. Null — no day offered — when any line has no band or a
 * band with no window, because the parcel then has no day the store has
 * promised.
 */
export function storeSlotSpeed(lines: SlotLine[]): DeliverySpeed | null {
  if (!lines.length) return null;
  const speeds: DeliverySpeed[] = [];
  for (const line of lines) {
    const band = line.choice === "fast" ? line.fastSpeed : line.speed;
    if (!isDeliverySpeed(band) || band === "made_to_order") return null;
    speeds.push(band);
  }
  return slowestSpeed(speeds);
}

/** Whether a chosen day and window is still among those offered. */
export function slotStillOffered(slot: DeliverySlot, days: SlotDay[]): boolean {
  return days.some(day => day.date === slot.date && day.windows.includes(slot.window));
}

/**
 * What a stored choice means now: none chosen, kept, or `gone` when the day or
 * the window is no longer offered — a day passed, the store changed its band,
 * a line moved to Express, or the store offers no day at all any more. A gone
 * choice is said beside the store and holds the order back until it is
 * changed or cleared.
 */
export function slotState(slot: DeliverySlot | null, days: SlotDay[]): "unset" | "kept" | "gone" {
  if (!slot) return "unset";
  return slotStillOffered(slot, days) ? "kept" : "gone";
}
