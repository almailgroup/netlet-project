import { describe, expect, it } from "vitest";
import {
  acceptableAsk, acceptableOffer, askExpiry, daysLeft, isOpen, isSpendable,
  negotiable, offerExpiry, priceFor, resolveOffer, type OfferRow,
} from "./priceOffers.js";

const NOW = new Date("2026-09-20T12:00:00Z");
const inDays = (days: number) => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);

const row = (over: Partial<OfferRow> = {}): OfferRow => ({
  status: "offered",
  offeredPrice: "45.000",
  expiresAt: inDays(2),
  usedOnOrderId: null,
  ...over,
});

describe("what the row means now", () => {
  it("reports the stored state while the window is open", () => {
    expect(resolveOffer(row({ status: "pending" }), NOW)).toBe("pending");
    expect(resolveOffer(row(), NOW)).toBe("offered");
  });

  /* Derived from the date, so nothing has to run to make it true. */
  it("expires on the clock rather than on a job", () => {
    expect(resolveOffer(row({ expiresAt: inDays(-1) }), NOW)).toBe("expired");
    expect(resolveOffer(row({ status: "pending", expiresAt: inDays(-1) }), NOW)).toBe("expired");
  });

  /*
   * Spent beats expired: an order placed on the last afternoon must not be
   * reported a week later as a price that ran out.
   */
  it("says used even after the window closed", () => {
    expect(resolveOffer(row({ usedOnOrderId: 7, expiresAt: inDays(-30) }), NOW)).toBe("used");
  });

  it("keeps a refusal a refusal whatever the date says", () => {
    expect(resolveOffer(row({ status: "declined", expiresAt: inDays(-1) }), NOW)).toBe("declined");
    expect(resolveOffer(row({ status: "withdrawn", expiresAt: inDays(-1) }), NOW)).toBe("withdrawn");
  });

  /* A gap in our own row is our problem, not the shopper's. */
  it("leaves a row with no date open", () => {
    expect(resolveOffer(row({ expiresAt: null }), NOW)).toBe("offered");
    expect(resolveOffer(row({ expiresAt: "not a date" }), NOW)).toBe("offered");
  });

  it("knows what is spendable and what is still waiting", () => {
    expect(isSpendable(row(), NOW)).toBe(true);
    expect(isSpendable(row({ offeredPrice: null }), NOW)).toBe(false);
    expect(isSpendable(row({ expiresAt: inDays(-1) }), NOW)).toBe(false);
    expect(isOpen(row({ status: "pending" }), NOW)).toBe(true);
    expect(isOpen(row(), NOW)).toBe(false);
  });
});

describe("what the shopper pays", () => {
  it("charges the agreed price while it is live", () => {
    expect(priceFor("55.000", row(), NOW)).toBe("45.000");
  });

  /*
   * The rule that matters most. Charging somebody more than the shelf says
   * because they once asked for a discount is the worst thing this could do.
   */
  it("never charges more than the shelf, however the agreement read", () => {
    expect(priceFor("40.000", row({ offeredPrice: "45.000" }), NOW)).toBe("40.000");
  });

  it("charges the shelf price with no live agreement at all", () => {
    expect(priceFor("55.000", null, NOW)).toBe("55.000");
    expect(priceFor("55.000", row({ expiresAt: inDays(-1) }), NOW)).toBe("55.000");
    expect(priceFor("55.000", row({ status: "pending", offeredPrice: null }), NOW)).toBe("55.000");
    expect(priceFor("55.000", row({ usedOnOrderId: 3 }), NOW)).toBe("55.000");
  });
});

describe("what may be asked and answered", () => {
  it("takes an ask below the shelf price", () => {
    expect(acceptableAsk("55.000", "45.000")).toBe(true);
  });

  it("refuses an ask at or above the shelf price", () => {
    expect(acceptableAsk("55.000", "55.000")).toBe(false);
    expect(acceptableAsk("55.000", "60.000")).toBe(false);
  });

  /* A free product must not arrive by negotiation either. */
  it("refuses nothing, and nonsense", () => {
    for (const bad of ["0.000", "-5.000", "", "free", "1e3"]) {
      expect({ bad, ok: acceptableAsk("55.000", bad) }).toEqual({ bad, ok: false });
      expect({ bad, ok: acceptableOffer("55.000", bad) }).toEqual({ bad, ok: false });
    }
    expect(acceptableAsk("0.000", "45.000")).toBe(false);
  });

  /* A seller saying "no discount, but here is my price" should not have to decline. */
  it("lets the seller answer at the shelf price", () => {
    expect(acceptableOffer("55.000", "55.000")).toBe(true);
    expect(acceptableOffer("55.000", "55.001")).toBe(false);
  });
});

describe("who may be asked", () => {
  it("lets a product override its vendor in both directions", () => {
    expect(negotiable(false, true)).toBe(true);
    expect(negotiable(true, false)).toBe(false);
  });

  /* Absent is not an override — the same rule the commission rate follows. */
  it("inherits the vendor when the product has no opinion", () => {
    expect(negotiable(true, null)).toBe(true);
    expect(negotiable(false, null)).toBe(false);
  });
});

describe("the clock", () => {
  it("gives the seller longer than the shopper", () => {
    expect(askExpiry(NOW).getTime()).toBeGreaterThan(offerExpiry(NOW).getTime());
  });

  /* A price still spendable must never be described as gone. */
  it("rounds the last few hours up to a whole day", () => {
    expect(daysLeft(row({ expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000) }), NOW)).toBe(1);
    expect(daysLeft(row({ expiresAt: inDays(2.4) }), NOW)).toBe(3);
  });

  it("has nothing to count on a price that cannot be spent", () => {
    expect(daysLeft(row({ status: "declined" }), NOW)).toBeNull();
    expect(daysLeft(row({ expiresAt: null }), NOW)).toBeNull();
  });
});
