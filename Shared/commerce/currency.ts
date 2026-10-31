/**
 * The currency a shopper reads prices in, on the owner's word ("add a
 * currency option in the settings … USD, GBP, EUR, and all GCC currencies").
 *
 * **NetLet sells in Kuwaiti dinars, and that does not change.** Every price
 * is stored, charged, frozen on an order and printed on an invoice in KWD,
 * and the driver collects dinars at the door. A display currency is a
 * reading aid: a price converted at the day's rate and marked "≈" so nobody
 * takes it for what they will pay. Checkout states the dinar figure as the
 * one charged, and records — orders, invoices, points, the portal — are never
 * converted, since converting a past payment at today's rate would put a
 * figure on it that was never paid.
 *
 * Pure and shared: the server reads the day's rates with `ratesFromFeed`, the
 * pages and the app convert with `convertFromDinars`.
 */

/** The shop's own currency, the one everything is charged in. */
export const SHOP_CURRENCY = "KWD";

/** The dinar first, then the owner's list: the US dollar, the pound, the euro and the Gulf's. */
export const DISPLAY_CURRENCIES = ["KWD", "USD", "GBP", "EUR", "SAR", "QAR", "AED", "BHD", "OMR"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export function isDisplayCurrency(code: unknown): code is DisplayCurrency {
  return typeof code === "string" && (DISPLAY_CURRENCIES as readonly string[]).includes(code);
}

/**
 * How many of each currency one dinar buys, when no day's rate could be read.
 * The Gulf's currencies are pegged to the US dollar (the riyal at 3.75, the
 * Qatari riyal at 3.64, the dirham at 3.6725, the Bahraini dinar at 0.376,
 * the Omani rial at 0.3845), so they move with it; the dinar, the pound and
 * the euro float, and these are approximate as of `RATES_AS_OF`.
 */
export const REFERENCE_RATES: Record<DisplayCurrency, number> = {
  KWD: 1,
  USD: 3.26,
  GBP: 2.44,
  EUR: 2.8,
  SAR: 12.225,
  QAR: 11.866,
  AED: 11.972,
  BHD: 1.2258,
  OMR: 1.2535,
};
export const RATES_AS_OF = "2026-10-31";

export type Rates = Record<DisplayCurrency, number>;

/**
 * A day's rate is taken only within this share of the reference: a feed that
 * answers with a typo or another base must not put a price a hundred times
 * wrong on every card.
 */
const PLAUSIBLE = 0.35;

/** The minor digits each is written with: the dinars and the rial in fils (three), the rest in two. */
export function minorDigits(code: DisplayCurrency): number {
  return code === "KWD" || code === "BHD" || code === "OMR" ? 3 : 2;
}

/**
 * A dinar amount in another currency, rounded to that currency's own minor
 * unit. A currency with no rate is the dinar amount unchanged — the caller
 * shows dinars rather than an invented figure.
 */
export function convertFromDinars(dinars: number, code: DisplayCurrency, rates: Partial<Rates> = REFERENCE_RATES): number {
  const rate = code === "KWD" ? 1 : rates[code];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return dinars;
  const scale = 10 ** minorDigits(code);
  return Math.round(dinars * rate * scale) / scale;
}

/**
 * The day's rates from a feed answering for one dinar (ExchangeRate-API's
 * open shape: `{ result: "success", base_code: "KWD", rates: { USD: 3.25 … } }`),
 * each held to the reference within `PLAUSIBLE`; anything missing or out of
 * bounds keeps the reference. Null when the feed is not a dinar feed at all.
 */
export function ratesFromFeed(feed: unknown): Rates | null {
  if (!feed || typeof feed !== "object") return null;
  const body = feed as { result?: unknown; base_code?: unknown; base?: unknown; rates?: unknown };
  if (body.result !== undefined && body.result !== "success") return null;
  const base = body.base_code ?? body.base;
  if (base !== undefined && base !== SHOP_CURRENCY) return null;
  if (!body.rates || typeof body.rates !== "object") return null;
  const given = body.rates as Record<string, unknown>;
  const rates = { ...REFERENCE_RATES };
  let read = 0;
  for (const code of DISPLAY_CURRENCIES) {
    if (code === "KWD") continue;
    const value = given[code];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    const reference = REFERENCE_RATES[code];
    if (Math.abs(value - reference) / reference > PLAUSIBLE) continue;
    rates[code] = value;
    read += 1;
  }
  return read > 0 ? rates : null;
}
