import { describe, expect, it } from "vitest";
import { bagGroups, freeDeliveryProgress } from "./bagGroups";
import type { CartDeliveryLine, CartItem } from "@shared/commerce/types";

const kwd = (amount: string) => ({ amount, currencyCode: "KWD" });
const line = (lineId: string, vendor: CartItem["vendor"]): CartItem => ({
  lineId,
  variantId: lineId,
  productHandle: `p-${lineId}`,
  productTitle: `Product ${lineId}`,
  variantTitle: "Default",
  image: null,
  unitPrice: kwd("1.000"),
  quantity: 1,
  lineTotal: kwd("1.000"),
  measure: { unit: "each", stepAmount: 1 },
  vendor,
});
const acme = { id: 2, name: "Acme", nameAr: null, slug: "acme" };
const dar = { id: 3, name: "Dar Home", nameAr: "دار", slug: "dar-home" };
const row = (vendorId: number, extra: Partial<CartDeliveryLine> = {}): CartDeliveryLine => ({
  vendorId, vendorName: "", goods: kwd("6.500"), fee: kwd("1.000"), free: false, toFree: kwd("3.500"), ...extra,
});

describe("the bag by store", () => {
  it("keeps each store's lines together in the order they were added, with its own parcels", () => {
    const groups = bagGroups({
      items: [line("1", acme), line("2", dar), line("3", acme)],
      delivery: { total: kwd("2.000"), perVendor: [row(2, { choice: "fast" }), row(3), row(2)] },
    })!;
    expect(groups.map(group => group.key)).toEqual(["acme", "dar-home"]);
    expect(groups[0].items.map(item => item.lineId)).toEqual(["1", "3"]);
    expect(groups[0].delivery.map(parcel => parcel.choice ?? "regular")).toEqual(["regular", "fast"]);
    expect(groups[1].delivery).toHaveLength(1);
  });

  it("takes a line drawn before the server answered into its store's group", () => {
    const ghost = line("pending:9", { id: null, name: "Acme", nameAr: null, slug: "acme" });
    const groups = bagGroups({ items: [ghost, line("1", acme)], delivery: { total: kwd("0"), perVendor: [row(2)] } })!;
    expect(groups).toHaveLength(1);
    expect(groups[0].store.id).toBe(2);
    expect(groups[0].delivery).toHaveLength(1);
  });

  it("draws one list when any line names no store", () => {
    expect(bagGroups({ items: [line("1", acme), line("2", null)], delivery: { total: kwd("0"), perVendor: [] } })).toBeNull();
    expect(bagGroups({ items: [], delivery: { total: kwd("0"), perVendor: [] } })).toBeNull();
  });

  it("measures the way to free delivery from the server's own figures", () => {
    expect(freeDeliveryProgress({ goods: kwd("6.500"), toFree: kwd("3.500") })).toBeCloseTo(0.65);
    expect(freeDeliveryProgress({ goods: kwd("6.500"), toFree: null })).toBeNull();
  });
});
