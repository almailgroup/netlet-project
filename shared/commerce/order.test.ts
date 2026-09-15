import { describe, expect, it } from "vitest";
import {
  draftOrder,
  freezeLine,
  orderReference,
  refusalFor,
  sliceByVendor,
  type PriceableLine,
} from "./order.js";

const line = (over: Partial<PriceableLine> = {}): PriceableLine => ({
  variantId: 1,
  productId: 10,
  vendorId: 100,
  quantity: 1,
  unitPrice: "24.375",
  productTitle: "Harbour Desk Lamp",
  variantTitle: "Charcoal",
  vendorName: "Acme",
  sku: "LAMP-CH",
  vendorRule: { percent: "10", fixed: null },
  ...over,
});

describe("freezeLine", () => {
  it("prices the line and splits it by the rate in force", () => {
    const frozen = freezeLine(line({ quantity: 2 }));
    expect(frozen.lineTotal).toBe("48.750");
    expect(frozen.commissionAmount).toBe("4.875");
    expect(frozen.vendorNet).toBe("43.875");
    // Line total is exactly what the two halves come to.
    expect(frozen.commissionAmount).toBe("4.875");
    expect(Number(frozen.commissionAmount) + Number(frozen.vendorNet)).toBeCloseTo(48.75, 3);
  });

  /*
   * A product's own rate overrides its vendor's, and an absent product rate is
   * not a zero one — the distinction commission.ts exists to protect, checked
   * again here because this is where it reaches the money.
   */
  it("prefers a product's own rate and records which one applied", () => {
    const withOverride = freezeLine(line({ productRule: { percent: "0", fixed: null } }));
    expect(withOverride.commissionPercent).toBe("0");
    expect(withOverride.commissionAmount).toBe("0.000");

    const withoutOverride = freezeLine(line({ productRule: null }));
    expect(withoutOverride.commissionPercent).toBe("10");
    expect(withoutOverride.commissionAmount).toBe("2.437");
  });

  it("copies the labels rather than leaving them to be joined later", () => {
    const frozen = freezeLine(line());
    expect(frozen.productTitle).toBe("Harbour Desk Lamp");
    expect(frozen.variantTitle).toBe("Charcoal");
    expect(frozen.vendorName).toBe("Acme");
    expect(frozen.sku).toBe("LAMP-CH");
  });

  it("normalises the price it froze, so a column of orders lines up", () => {
    expect(freezeLine(line({ unitPrice: "5" })).unitPrice).toBe("5.000");
    expect(freezeLine(line({ unitPrice: "5.1" })).unitPrice).toBe("5.100");
  });
});

describe("draftOrder", () => {
  it("totals the basket and NetLet's cut across it", () => {
    const draft = draftOrder([
      line({ variantId: 1, quantity: 2, unitPrice: "24.375" }),
      line({ variantId: 2, quantity: 1, unitPrice: "11.250" }),
    ]);
    expect(draft.totals.itemsTotal).toBe("60.000");
    expect(draft.totals.commissionTotal).toBe("6.000");
    expect(draft.totals.grandTotal).toBe("60.000");
  });

  it("adds delivery to the grand total but never to the items total", () => {
    const draft = draftOrder([line({ quantity: 2 })], "2.500");
    expect(draft.totals.itemsTotal).toBe("48.750");
    expect(draft.totals.deliveryTotal).toBe("2.500");
    expect(draft.totals.grandTotal).toBe("51.250");
    // Delivery is NetLet's, not the vendor's — it must not move the cut.
    expect(draft.totals.commissionTotal).toBe("4.875");
  });

  it("drops a line nobody is actually buying", () => {
    const draft = draftOrder([line({ quantity: 0 }), line({ variantId: 2, quantity: 1 })]);
    expect(draft.lines).toHaveLength(1);
    expect(draft.totals.itemsTotal).toBe("24.375");
  });

  it("totals an empty basket to zero rather than to NaN", () => {
    expect(draftOrder([]).totals).toEqual({
      itemsTotal: "0.000",
      deliveryTotal: "0.000",
      grandTotal: "0.000",
      commissionTotal: "0.000",
    });
  });

  /* The reason none of this goes through a float. */
  it("totals many small amounts exactly", () => {
    const draft = draftOrder(
      Array.from({ length: 10 }, (_, index) => line({ variantId: index, unitPrice: "0.100" })),
    );
    expect(draft.totals.itemsTotal).toBe("1.000");
  });
});

describe("sliceByVendor", () => {
  const draft = draftOrder([
    line({ variantId: 1, vendorId: 100, vendorName: "Acme", quantity: 2, unitPrice: "24.375" }),
    line({ variantId: 2, vendorId: 200, vendorName: "Other", quantity: 1, unitPrice: "11.250" }),
    line({ variantId: 3, vendorId: 100, vendorName: "Acme", quantity: 1, unitPrice: "5.000" }),
  ]);

  it("gives each seller their own lines and their own subtotal", () => {
    const slices = sliceByVendor(draft.lines);
    expect(slices).toHaveLength(2);

    const acme = slices.find(slice => slice.vendorId === 100)!;
    expect(acme.lines).toHaveLength(2);
    expect(acme.itemsTotal).toBe("53.750");
    expect(acme.vendorNet).toBe("48.375");

    const other = slices.find(slice => slice.vendorId === 200)!;
    expect(other.lines).toHaveLength(1);
    expect(other.itemsTotal).toBe("11.250");
  });

  /* A seller must never be shown the rest of somebody else's basket. */
  it("never leaks another seller's lines into a slice", () => {
    for (const slice of sliceByVendor(draft.lines)) {
      expect(slice.lines.every(line => line.vendorId === slice.vendorId)).toBe(true);
    }
  });

  it("adds back up to the whole order", () => {
    const slices = sliceByVendor(draft.lines);
    const summed = slices.reduce((total, slice) => total + Number(slice.itemsTotal), 0);
    expect(summed).toBeCloseTo(Number(draft.totals.itemsTotal), 3);
  });

  it("orders the slices the same way twice", () => {
    expect(sliceByVendor(draft.lines).map(s => s.vendorId)).toEqual([100, 200]);
    expect(sliceByVendor([...draft.lines].reverse()).map(s => s.vendorId)).toEqual([100, 200]);
  });
});

describe("orderReference", () => {
  const when = new Date("2026-09-15T21:00:00.000Z");

  it("carries the date, so support can find it without a lookup", () => {
    expect(orderReference(when, () => 0)).toMatch(/^NL-20260915-[A-Z0-9]{5}$/);
  });

  /*
   * A reference read down a phone must not hinge on hearing "O" versus "zero".
   */
  it("avoids the characters people mishear", () => {
    const tails = Array.from({ length: 200 }, (_, i) => orderReference(when, () => i / 200))
      .map(reference => reference.split("-")[2]);
    expect(tails.every(tail => tail.length === 5)).toBe(true);

    const everyCharacterUsed = new Set(tails.join(""));
    for (const confusable of ["O", "0", "I", "1", "L", "S", "5"]) {
      expect(everyCharacterUsed.has(confusable)).toBe(false);
    }
  });

  it("is not the serial id, so it cannot be counted", () => {
    const first = orderReference(when);
    const second = orderReference(when);
    expect(first).not.toBe(second);
  });
});

describe("refusalFor", () => {
  const details = { email: "shopper@example.com", addressLine: "Block 4, Street 12" };

  it("accepts a basket that can actually be bought", () => {
    expect(refusalFor([line()], details)).toBeNull();
  });

  it("refuses an empty basket, and one with nothing left in it", () => {
    expect(refusalFor([], details)).toBe("order.empty");
    expect(refusalFor([line({ quantity: 0 })], details)).toBe("order.empty");
  });

  it("refuses without somewhere to send it or somebody to tell", () => {
    expect(refusalFor([line()], { ...details, email: "" })).toBe("order.noContact");
    expect(refusalFor([line()], { ...details, addressLine: "   " })).toBe("order.noAddress");
  });

  /*
   * The same money rule that blocks publishing an unpriced product, applied
   * once more at the last possible moment: past here it is a payment for
   * nothing and a parcel nobody was paid for.
   */
  it("refuses a line priced at zero, however it got there", () => {
    expect(refusalFor([line({ unitPrice: "0.000" })], details)).toBe("order.zeroPriced");
    expect(refusalFor([line({ unitPrice: "-1.000" })], details)).toBe("order.zeroPriced");
  });
});
