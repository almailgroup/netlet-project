import { describe, expect, it } from "vitest";
import {
  chargesDelivery, freezeDelivery, frozenTotal, quoteDelivery, type DeliveryGroup,
} from "./delivery.js";

const group = (over: Partial<DeliveryGroup> = {}): DeliveryGroup => ({
  vendorId: 1,
  vendorName: "Acme",
  goods: "10.000",
  rule: { flat: "1.500", freeOver: null },
  ...over,
});

describe("what each seller charges", () => {
  it("charges each seller's own fee and sums them", () => {
    const quote = quoteDelivery([
      group(),
      group({ vendorId: 2, vendorName: "Other", rule: { flat: "2.250", freeOver: null } }),
    ]);
    expect(quote.perVendor.map(row => row.fee)).toEqual(["1.500", "2.250"]);
    expect(quote.total).toBe("3.750");
  });

  /*
   * A gap in our own form, not evidence the seller delivers for nothing —
   * and charging a number they never set would be inventing a price.
   */
  it("delivers free for a seller who recorded no fee", () => {
    const quote = quoteDelivery([group({ rule: { flat: null, freeOver: null } })]);
    expect(quote.perVendor[0]).toMatchObject({ fee: "0.000", free: true, toFree: null });
    expect(quote.total).toBe("0.000");
  });

  it("treats a blank or unreadable fee the same way", () => {
    for (const flat of ["", "   ", "free", "-2.000", "1e3"]) {
      expect(quoteDelivery([group({ rule: { flat, freeOver: null } })]).total).toBe("0.000");
    }
  });
});

describe("free over a threshold", () => {
  it("waives the fee once this seller's goods clear it", () => {
    const quote = quoteDelivery([group({ goods: "25.000", rule: { flat: "1.500", freeOver: "20.000" } })]);
    expect(quote.perVendor[0]).toMatchObject({ fee: "0.000", free: true, toFree: null });
  });

  it("waives it exactly at the threshold, not a fil above", () => {
    expect(quoteDelivery([group({ goods: "20.000", rule: { flat: "1.500", freeOver: "20.000" } })]).total).toBe("0.000");
    expect(quoteDelivery([group({ goods: "19.999", rule: { flat: "1.500", freeOver: "20.000" } })]).total).toBe("1.500");
  });

  /*
   * The rule that stops one seller's money being spent on another's sale: a
   * shopper with KWD 20 at one shop and KWD 5 at another has not earned free
   * delivery from the second.
   */
  it("measures the threshold per seller and never across the basket", () => {
    const quote = quoteDelivery([
      group({ goods: "20.000", rule: { flat: "1.500", freeOver: "20.000" } }),
      group({ vendorId: 2, vendorName: "Other", goods: "5.000", rule: { flat: "2.000", freeOver: "20.000" } }),
    ]);
    expect(quote.perVendor.map(row => row.fee)).toEqual(["0.000", "2.000"]);
    expect(quote.total).toBe("2.000");
  });

  /* A threshold nobody can see is just a higher price with a rumour attached. */
  it("says how much more would make it free, and only while that helps", () => {
    const quote = quoteDelivery([
      group({ goods: "16.500", rule: { flat: "1.500", freeOver: "20.000" } }),
      group({ vendorId: 2, vendorName: "Other", goods: "25.000", rule: { flat: "1.500", freeOver: "20.000" } }),
      group({ vendorId: 3, vendorName: "Third", goods: "5.000", rule: { flat: "1.500", freeOver: null } }),
    ]);
    expect(quote.perVendor[0].toFree).toBe("3.500");
    // Already free: a shortfall of zero is noise, not a nudge.
    expect(quote.perVendor[1].toFree).toBeNull();
    // No threshold at all: nothing to aim at.
    expect(quote.perVendor[2].toFree).toBeNull();
  });
});

describe("exactness", () => {
  /* Summed in fils. Adding decimal strings pairwise rounds at every step. */
  it("is exact over amounts a float would lose", () => {
    const quote = quoteDelivery(Array.from({ length: 3 }, (_, index) =>
      group({ vendorId: index, rule: { flat: "0.375", freeOver: null } })));
    expect(quote.total).toBe("1.125");
  });
});

describe("what the order remembers", () => {
  it("freezes who charged what, and sums back to the same figure", () => {
    const quote = quoteDelivery([
      group(),
      group({ vendorId: 2, vendorName: "Other", rule: { flat: "2.250", freeOver: null } }),
    ]);
    const frozen = freezeDelivery(quote);
    /* `destinationLabel` is null on a basket going to one door, which is
       nearly every basket — the door only appears once one is chosen. */
    expect(frozen).toEqual([
      { vendorId: 1, vendorName: "Acme", destinationLabel: null, fee: "1.500" },
      { vendorId: 2, vendorName: "Other", destinationLabel: null, fee: "2.250" },
    ]);
    expect(frozenTotal(frozen)).toBe(quote.total);
  });

  it("keeps a removed seller's frozen name", () => {
    const frozen = freezeDelivery(quoteDelivery([group({ vendorId: null, vendorName: "Gone Ltd" })]));
    expect(frozen[0]).toMatchObject({ vendorId: null, vendorName: "Gone Ltd" });
  });
});

describe("whether a page should draw any of this", () => {
  it("is true only for a rule that would ever charge", () => {
    expect(chargesDelivery({ flat: "1.500", freeOver: null })).toBe(true);
    expect(chargesDelivery({ flat: "0.000", freeOver: "20.000" })).toBe(false);
    expect(chargesDelivery({ flat: null, freeOver: "20.000" })).toBe(false);
  });
});
