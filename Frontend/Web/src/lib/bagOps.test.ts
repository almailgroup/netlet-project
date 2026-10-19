import { describe, expect, it } from "vitest";
import type { Cart, CartItem, Product } from "@shared/commerce/types";
import { applyBagOp, ghostLine, ghostLineId, NO_BAG, realLineId, type BagOp } from "./bagOps";

const kwd = (amount: string) => ({ amount, currencyCode: "KWD" });

function line(overrides: Partial<CartItem> = {}): CartItem {
  return {
    lineId: "11",
    variantId: "5",
    productHandle: "lamp",
    productTitle: "Brass lamp",
    variantTitle: "Default",
    image: null,
    unitPrice: kwd("12.500"),
    quantity: 2,
    addons: [],
    addonsTotal: null,
    lineTotal: kwd("25.000"),
    measure: { unit: "each", stepAmount: 1 },
    ...overrides,
  };
}

function bag(items: CartItem[], delivery = "1.500"): Cart {
  return {
    ...NO_BAG,
    id: "cart-1",
    items,
    itemCount: items.reduce((n, item) => n + item.quantity, 0),
    subtotal: kwd("25.000"),
    delivery: { perVendor: [], total: kwd(delivery), memberWaived: null },
    total: kwd("26.500"),
  };
}

const product = {
  id: "p1",
  handle: "kettle",
  title: "Kettle",
  images: [{ url: "/media/k.webp", altText: "Kettle" }],
  variants: [{ id: "9", title: "Default", price: kwd("8.250"), measure: { unit: "each", stepAmount: 1 } }],
} as unknown as Product;

const run = (cart: Cart | null, ...ops: BagOp[]) => ops.reduce<Cart | null>(applyBagOp, cart);

describe("a press drawn before the server answers", () => {
  it("changes a line's quantity, its total and the subtotal, and keeps the last delivery", () => {
    const next = run(bag([line()]), { kind: "set", lineId: "11", quantity: 3 })!;
    expect(next.items[0].quantity).toBe(3);
    expect(next.items[0].lineTotal.amount).toBe("37.500");
    expect(next.itemCount).toBe(3);
    expect(next.subtotal.amount).toBe("37.500");
    expect(next.total.amount).toBe("39.000");
  });

  it("prices a line's extras per unit, as the server does", () => {
    const fitted = line({ addons: [{ id: "1", label: "Fitting", kind: "service", price: kwd("2.000") }], addonsTotal: kwd("4.000"), lineTotal: kwd("29.000") });
    const next = run(bag([fitted]), { kind: "set", lineId: "11", quantity: 3 })!;
    expect(next.items[0].addonsTotal?.amount).toBe("6.000");
    expect(next.items[0].lineTotal.amount).toBe("43.500");
  });

  it("takes a line out on remove", () => {
    const next = run(bag([line(), line({ lineId: "12", variantId: "6", quantity: 1, lineTotal: kwd("12.500") })]), { kind: "remove", lineId: "11" })!;
    expect(next.items.map(item => item.lineId)).toEqual(["12"]);
    expect(next.itemCount).toBe(1);
    expect(next.subtotal.amount).toBe("12.500");
  });

  it("adds onto the variant's line, as the server keeps one per variant, and stops at the ceiling", () => {
    expect(run(bag([line()]), { kind: "add", variantId: "5", quantity: 1, ghost: null })!.items[0].quantity).toBe(3);
    expect(run(bag([line({ quantity: 98 })]), { kind: "add", variantId: "5", quantity: 5, ghost: null })!.items[0].quantity).toBe(99);
  });

  it("draws a card's new line from its product, into a bag that does not exist yet", () => {
    const ghost = ghostLine(product, "9", 2);
    const next = run(null, { kind: "add", variantId: "9", quantity: 2, ghost })!;
    expect(next.id).toBe("");
    expect(next.items[0]).toMatchObject({ lineId: ghostLineId("9"), productTitle: "Kettle", quantity: 2 });
    expect(next.items[0].lineTotal.amount).toBe("16.500");
    expect(next.itemCount).toBe(2);
  });

  it("counts an add it cannot draw, and keeps that count through later presses", () => {
    const next = run(bag([line()]), { kind: "add", variantId: "7", quantity: 2, ghost: null }, { kind: "set", lineId: "11", quantity: 1 })!;
    expect(next.items).toHaveLength(1);
    expect(next.itemCount).toBe(3);
  });

  it("sends a press on a drawn-ahead line to the real one once the server has made it", () => {
    const answered = bag([line({ lineId: "40", variantId: "9", quantity: 2, unitPrice: kwd("8.250"), lineTotal: kwd("16.500") })]);
    expect(realLineId(answered, ghostLineId("9"))).toBe("40");
    expect(realLineId(answered, "40")).toBe("40");
    expect(realLineId(bag([]), ghostLineId("9"))).toBeNull();
    /* A plus pressed on the drawn-ahead line, applied over the server's answer, changes the real line. */
    expect(run(answered, { kind: "set", lineId: ghostLineId("9"), quantity: 3 })!.items[0].quantity).toBe(3);
  });
});
