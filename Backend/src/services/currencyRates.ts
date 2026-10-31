/**
 * The day's rates for the display currency (`Shared/commerce/currency.ts`).
 *
 * Read from ExchangeRate-API's open endpoint for one dinar — no account, no
 * key, nothing about the shopper sent — with a four-second deadline, and kept
 * six hours per instance: rates are one figure for everybody, an instance
 * that reads them a little later than another shows a price a fraction of a
 * cent apart, and nothing is counted or charged by them. Any way the feed
 * does not answer is the reference table, said as `source: "reference"`, so
 * a page never waits on a third party to show a price.
 *
 * `EXCHANGE_RATES_URL` points it elsewhere; `off` keeps the reference alone.
 */
import { REFERENCE_RATES, RATES_AS_OF, ratesFromFeed, type Rates } from "../../../Shared/commerce/currency.js";

const DEFAULT_URL = "https://open.er-api.com/v6/latest/KWD";
const KEEP_MS = 6 * 60 * 60 * 1000;
const DEADLINE_MS = 4000;

export type RatesAnswer = { rates: Rates; asOf: string; source: "live" | "reference" };

let kept: { answer: RatesAnswer; at: number } | null = null;

/** Only for tests: forget what was read. */
export function forgetRates() {
  kept = null;
}

export async function currencyRates(fetcher: typeof fetch = fetch, now = Date.now()): Promise<RatesAnswer> {
  if (kept && now - kept.at < KEEP_MS) return kept.answer;
  const reference: RatesAnswer = { rates: { ...REFERENCE_RATES }, asOf: RATES_AS_OF, source: "reference" };
  const url = process.env.EXCHANGE_RATES_URL?.trim() || DEFAULT_URL;
  if (url === "off") return reference;
  let answer = reference;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(DEADLINE_MS), headers: { accept: "application/json" } });
    if (response.ok) {
      const body = (await response.json()) as { time_last_update_unix?: unknown };
      const rates = ratesFromFeed(body);
      if (rates) {
        const stamp = typeof body.time_last_update_unix === "number" ? new Date(body.time_last_update_unix * 1000) : new Date(now);
        answer = { rates, asOf: stamp.toISOString().slice(0, 10), source: "live" };
      }
    }
  } catch {
    // The reference stands; a slow or absent feed never holds a page.
  }
  // A failure is kept for a shorter while, so the next read tries again soon.
  kept = { answer, at: answer.source === "live" ? now : now - KEEP_MS + 10 * 60 * 1000 };
  return answer;
}
