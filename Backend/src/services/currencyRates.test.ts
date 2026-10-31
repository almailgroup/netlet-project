import { afterEach, describe, expect, it } from "vitest";
import { REFERENCE_RATES } from "../../../Shared/commerce/currency.js";
import { currencyRates, forgetRates } from "./currencyRates.js";

const feed = (body: unknown, ok = true) => (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 503 })) as unknown as typeof fetch;

describe("the day's rates", () => {
  afterEach(() => { forgetRates(); delete process.env.EXCHANGE_RATES_URL; });

  it("reads a dinar feed and dates it by the feed", async () => {
    const answer = await currencyRates(feed({ result: "success", base_code: "KWD", time_last_update_unix: 1793404800, rates: { USD: 3.25, GBP: 2.41 } }));
    expect(answer.source).toBe("live");
    expect(answer.rates.USD).toBe(3.25);
    expect(answer.rates.SAR).toBe(REFERENCE_RATES.SAR);
    expect(answer.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("falls back to the reference when the feed fails or says nonsense", async () => {
    expect((await currencyRates(feed({}, false))).source).toBe("reference");
    forgetRates();
    const thrown = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect((await currencyRates(thrown)).rates).toEqual(REFERENCE_RATES);
    forgetRates();
    expect((await currencyRates(feed({ result: "success", base_code: "KWD", rates: { USD: 999 } }))).source).toBe("reference");
  });

  it("keeps a live answer and asks again soon after a failure", async () => {
    const now = Date.now();
    await currencyRates(feed({ result: "success", base_code: "KWD", rates: { USD: 3.25 } }), now);
    const again = await currencyRates(feed({}, false), now + 60_000);
    expect(again.source).toBe("live");
    forgetRates();
    await currencyRates(feed({}, false), now);
    const later = await currencyRates(feed({ result: "success", base_code: "KWD", rates: { USD: 3.27 } }), now + 11 * 60_000);
    expect(later.rates.USD).toBe(3.27);
  });

  it("asks nobody when switched off", async () => {
    process.env.EXCHANGE_RATES_URL = "off";
    const never = (async () => { throw new Error("asked"); }) as unknown as typeof fetch;
    expect((await currencyRates(never)).source).toBe("reference");
  });
});
