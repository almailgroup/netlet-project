/**
 * The shared input shapes, where one carries a rule rather than a bound.
 */
import { describe, expect, it } from "vitest";
import { lastDay } from "./schemas.js";
import { discountAllowed } from "../../Shared/inventory/discountLicence.js";
import { giftCardRefusal, voucherRefusal } from "../../Shared/commerce/vouchers.js";

describe("the last day something is good for", () => {
  it("means the whole of that day in Kuwait, not its first second in UTC", () => {
    expect(lastDay.parse("2026-10-20").toISOString()).toBe("2026-10-20T20:59:59.999Z");
  });

  it("keeps a code, a card and a permit good until late on the day they name", () => {
    const ends = lastDay.parse("2026-10-20");
    const lateEvening = new Date("2026-10-20T23:30:00+03:00");
    const nextMorning = new Date("2026-10-21T00:00:01+03:00");

    const code = { kind: "percent" as const, value: "10", minSpend: null, startsAt: null, endsAt: ends, maxRedemptions: null, perShopper: 1 };
    expect(voucherRefusal(code, { goods: "10.000", used: 0, usedByShopper: 0, now: lateEvening })).toBeNull();
    expect(voucherRefusal(code, { goods: "10.000", used: 0, usedByShopper: 0, now: nextMorning })).toBe("voucher.expired");

    expect(giftCardRefusal({ remaining: "5.000", expiresAt: ends }, lateEvening)).toBeNull();
    expect(giftCardRefusal({ remaining: "5.000", expiresAt: ends }, nextMorning)).toBe("gift.expired");

    expect(discountAllowed({ number: "MOCI-1", expiresAt: ends }, lateEvening)).toEqual({ allowed: true });
    expect(discountAllowed({ number: "MOCI-1", expiresAt: ends }, nextMorning)).toMatchObject({ allowed: false, reason: "expired" });
  });

  it("takes a full moment as given, and refuses a day that does not exist", () => {
    expect(lastDay.parse("2026-10-20T12:00:00.000Z").toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(lastDay.safeParse("2026-13-45").success).toBe(false);
    expect(lastDay.nullable().parse(null)).toBeNull();
  });
});
