import { describe, expect, it } from "vitest";
import { codeCovers, codeShapeProblem, lineCodeDiscount, lineCodeRefusal, orderBoxRefusal, type ScopedCode } from "./lineCodes.js";
import { freezeLine, type PriceableLine } from "./order.js";
import { addMoney } from "../money.js";

const base: ScopedCode = {
  code: "LAMP10",
  kind: "percent",
  value: "10",
  minSpend: null,
  startsAt: null,
  endsAt: null,
  maxRedemptions: null,
  perShopper: 1,
  scope: "products",
  vendorId: 7,
  fundedBy: "store",
  productIds: [11],
};
const line = { productId: 11, vendorId: 7, value: "20.000", inBundle: false };
const fresh = { used: 0, usedByShopper: 0, permitValid: true };

describe("what a line code covers", () => {
  it("covers a listed product of its store, and a store code every product of its store", () => {
    expect(codeCovers(base, line)).toBe(true);
    expect(codeCovers(base, { productId: 12, vendorId: 7 })).toBe(false);
    expect(codeCovers({ ...base, scope: "store", productIds: [] }, { productId: 99, vendorId: 7 })).toBe(true);
    /* Another store's product is never covered, even one with the same id listed. */
    expect(codeCovers({ ...base, scope: "store", productIds: [] }, { productId: 11, vendorId: 8 })).toBe(false);
    expect(codeCovers(base, { productId: 11, vendorId: 8 })).toBe(false);
  });

  it("refuses with a reason the shopper can act on, in that order", () => {
    expect(lineCodeRefusal({ ...base, scope: "order", vendorId: null }, line, fresh)).toBe("voucher.orderWide");
    expect(lineCodeRefusal(base, { ...line, productId: 12 }, fresh)).toBe("voucher.notForProduct");
    expect(lineCodeRefusal(base, { ...line, inBundle: true }, fresh)).toBe("voucher.notOnSet");
    expect(lineCodeRefusal(base, line, { ...fresh, permitValid: false })).toBe("voucher.storeUnavailable");
    /* NetLet's own code on a store's product needs no permit: NetLet pays for it. */
    expect(lineCodeRefusal({ ...base, fundedBy: "netlet" }, line, { ...fresh, permitValid: false })).toBeNull();
    expect(lineCodeRefusal({ ...base, endsAt: "2020-01-01T00:00:00Z" }, line, fresh)).toBe("voucher.expired");
    expect(lineCodeRefusal(base, line, { ...fresh, usedByShopper: 1 })).toBe("voucher.alreadyUsed");
    expect(lineCodeRefusal({ ...base, minSpend: "25.000" }, line, fresh)).toBe("voucher.lineBelowMinimum");
    expect(lineCodeRefusal(base, line, fresh)).toBeNull();
  });

  it("takes a percentage of the line and caps a fixed amount at it", () => {
    expect(lineCodeDiscount(base, "20.000")).toBe("2.000");
    expect(lineCodeDiscount({ kind: "fixed", value: "25.000" }, "20.000")).toBe("20.000");
  });

  it("sends a product's code to its line and an order code to the order's box", () => {
    expect(orderBoxRefusal("products")).toBe("voucher.forProducts");
    expect(orderBoxRefusal("store")).toBe("voucher.forProducts");
    expect(orderBoxRefusal("order")).toBeNull();
  });

  it("checks what a code may be made with", () => {
    expect(codeShapeProblem({ scope: "order", vendorId: null, fundedBy: "netlet", productIds: [] })).toBeNull();
    expect(codeShapeProblem({ scope: "order", vendorId: 7, fundedBy: "store", productIds: [] })).toBe("promotion.orderIsNetlet");
    expect(codeShapeProblem({ scope: "store", vendorId: null, fundedBy: "netlet", productIds: [] })).toBe("promotion.needsStore");
    expect(codeShapeProblem({ scope: "products", vendorId: 7, fundedBy: "store", productIds: [] })).toBe("promotion.needsProducts");
  });
});

describe("freezing a line with its own code", () => {
  const priceable: PriceableLine = {
    variantId: 1,
    productId: 11,
    vendorId: 7,
    vendorName: "Acme",
    quantity: 2,
    unitPrice: "10.000",
    productTitle: "Lamp",
    variantTitle: "Default",
    sku: null,
    levels: { stock: 10, preorderStock: 0, preorderReleaseAt: null },
    vendorRule: { percent: "10.00", fixed: null },
    productRule: null,
  };

  it("takes a store's code out of the store's earnings, commission on what was paid", () => {
    const frozen = freezeLine({ ...priceable, codeDiscount: { codeId: 1, code: "LAMP10", amount: "2.000", fundedBy: "store" } });
    expect(frozen.lineTotal).toBe("18.000");
    expect(frozen.discountAmount).toBe("2.000");
    expect(frozen.commissionAmount).toBe("1.800");
    expect(frozen.vendorNet).toBe("16.200");
    expect(addMoney(frozen.commissionAmount, frozen.vendorNet)).toBe(frozen.lineTotal);
  });

  it("pays the store in full on NetLet's code, NetLet's cut carrying it", () => {
    const frozen = freezeLine({ ...priceable, codeDiscount: { codeId: 1, code: "NL3", amount: "3.000", fundedBy: "netlet" } });
    expect(frozen.lineTotal).toBe("17.000");
    expect(frozen.vendorNet).toBe("18.000");
    /* Below zero: NetLet paid more than it took, and the record says so. */
    expect(frozen.commissionAmount).toBe("-1.000");
    expect(addMoney(frozen.commissionAmount, frozen.vendorNet)).toBe(frozen.lineTotal);
  });

  it("caps the code at the line and leaves a line with none as it was", () => {
    expect(freezeLine({ ...priceable, codeDiscount: { codeId: 1, code: "BIG", amount: "50.000", fundedBy: "store" } }).lineTotal).toBe("0.000");
    const plain = freezeLine(priceable);
    expect(plain.lineTotal).toBe("20.000");
    expect(plain.discountCode).toBeNull();
    expect(plain.discountAmount).toBe("0.000");
  });
});
