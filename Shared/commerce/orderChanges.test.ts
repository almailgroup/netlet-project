import { describe, expect, it } from "vitest";
import { addMoney, toFils } from "../money.js";
import { stillOwed } from "./collection.js";
import { freezeLine } from "./order.js";
import {
  addressChangeState,
  deliveryAfter,
  discountAfter,
  linesAfter,
  quoteChange,
  shopperChangeState,
  splitLine,
  type ChangeLine,
  type ChangeOrder,
} from "./orderChanges.js";

const unpaid = { status: "pending_payment" };

/** A line priced the way the checkout prices it, so the split has something real to restate. */
function line(id: number, over: Partial<ChangeLine> & { rate?: string; addon?: string } = {}): ChangeLine {
  const frozen = freezeLine({
    variantId: id,
    productId: id,
    vendorId: over.vendorId ?? 1,
    vendorName: "Acme",
    productTitle: `Item ${id}`,
    variantTitle: null,
    sku: null,
    unitPrice: over.unitPrice ?? "10.000",
    quantity: over.quantity ?? 3,
    vendorRule: { percent: over.rate ?? "12.50", fixed: "0.250" },
    addons: over.addon ? [{ id: 1, kind: "fitting", label: "Fitting", price: over.addon }] : [],
  } as never);
  return {
    id,
    fulfilment: "pending",
    vendorId: over.vendorId ?? 1,
    vendorName: "Acme",
    quantity: frozen.quantity,
    unitPrice: frozen.unitPrice,
    lineTotal: frozen.lineTotal,
    commissionPercent: frozen.commissionPercent,
    commissionFixed: frozen.commissionFixed,
    commissionAmount: frozen.commissionAmount,
    vendorNet: frozen.vendorNet,
    affiliateVendorPercent: null,
    addonsPerUnit: over.addon ?? "0.000",
    bundleId: null,
    deliveryChoice: "regular",
    destinationLabel: null,
    ...over,
  };
}

describe("what a shopper may change", () => {
  it("is open while anything is still in the stores' hands, and only unpaid", () => {
    expect(shopperChangeState(unpaid, [{ fulfilment: "preparing" }, { fulfilment: "shipped" }])).toEqual({ changeable: true });
    expect(shopperChangeState(unpaid, [{ fulfilment: "shipped" }, { fulfilment: "delivered" }])).toEqual({ changeable: false, reason: "orders.changeCollected" });
    expect(shopperChangeState({ status: "paid" }, [{ fulfilment: "pending" }])).toEqual({ changeable: false, reason: "orders.changePaid" });
    expect(shopperChangeState({ status: "cancelled" }, [{ fulfilment: "cancelled" }])).toEqual({ changeable: false, reason: "orders.changeClosed" });
  });

  it("changes the address only while nothing going there has left", () => {
    expect(addressChangeState(unpaid, [{ fulfilment: "pending" }, { fulfilment: "preparing" }])).toEqual({ changeable: true });
    expect(addressChangeState(unpaid, [{ fulfilment: "pending" }, { fulfilment: "shipped" }])).toEqual({ changeable: false, reason: "orders.changeCollected" });
    /* A line going to an address of its own does not hold the order's back. */
    expect(addressChangeState(unpaid, [{ fulfilment: "pending" }, { fulfilment: "shipped", destination: { label: "Office" } }])).toEqual({ changeable: true });
  });
});

describe("splitting a line", () => {
  it("restates the kept part by the line's own rule, and the gone part is exactly the rest", () => {
    for (const over of [{}, { addon: "1.500" }, { rate: "7.25", unitPrice: "3.333", quantity: 7 }]) {
      const original = line(1, over);
      for (let keep = 1; keep < original.quantity; keep++) {
        const split = splitLine(original, keep)!;
        expect(split).not.toBeNull();
        expect(split.kept.quantity + split.gone.quantity).toBe(original.quantity);
        expect(addMoney(split.kept.lineTotal, split.gone.lineTotal)).toBe(original.lineTotal);
        expect(addMoney(split.kept.commissionAmount, split.gone.commissionAmount)).toBe(original.commissionAmount);
        expect(addMoney(split.kept.vendorNet, split.gone.vendorNet)).toBe(original.vendorNet);
        /* The finance identity holds on both halves. */
        expect(addMoney(split.kept.commissionAmount, split.kept.vendorNet)).toBe(split.kept.lineTotal);
        expect(addMoney(split.gone.commissionAmount, split.gone.vendorNet)).toBe(split.gone.lineTotal);
        /* And the kept part is what the checkout would have frozen for that many. */
        expect(split.kept).toEqual({ ...splitLine(line(1, { ...over, quantity: keep + 1 }), keep)!.kept });
      }
    }
  });

  it("refuses a line its rule does not reproduce, rather than inventing a figure", () => {
    expect(splitLine({ ...line(1), lineTotal: "29.000" }, 2)).toBeNull();
    expect(splitLine(line(1), 0)).toBeNull();
    expect(splitLine(line(1), 3)).toBeNull();
  });
});

describe("the change itself", () => {
  it("lowers, removes and refuses by the rules", () => {
    const lines = [line(1), line(2, { quantity: 1 })];
    const lowered = linesAfter(unpaid, lines, [{ lineId: 1, quantity: 2 }]);
    expect("lines" in lowered && lowered.lines.map(one => [one.id, one.quantity, one.fulfilment])).toEqual([[1, 2, "pending"], [-1, 1, "cancelled"], [2, 1, "pending"]]);
    const removed = linesAfter(unpaid, lines, [{ lineId: 2, quantity: 0 }]);
    expect("lines" in removed && removed.lines.find(one => one.id === 2)?.fulfilment).toBe("cancelled");
    expect(linesAfter(unpaid, lines, [{ lineId: 1, quantity: 3 }])).toEqual({ refused: "orders.changeNotLower" });
    expect(linesAfter(unpaid, lines, [{ lineId: 9, quantity: 0 }])).toEqual({ refused: "orders.changeLineGone" });
    expect(linesAfter(unpaid, lines, [])).toEqual({ refused: "orders.changeNothing" });
    expect(linesAfter(unpaid, [{ ...line(1), bundleId: 4 }], [{ lineId: 1, quantity: 0 }])).toEqual({ refused: "orders.changeBundle" });
    expect(linesAfter(unpaid, [{ ...line(1), fulfilment: "shipped" }, line(2)], [{ lineId: 1, quantity: 0 }])).toEqual({ refused: "orders.changeLineGone" });
  });
});

describe("delivery after a change", () => {
  const rules = new Map([[1, { flat: "2.000", freeOver: "25.000" }]]);
  it("charges the store's fee once what is left falls under its threshold", () => {
    const before = [line(1), line(2, { quantity: 1 })]; // 30 + 10 = 40, free over 25
    const after = [line(1), { ...line(2, { quantity: 1 }), fulfilment: "cancelled" }, ];
    const lowered = linesAfter(unpaid, before, [{ lineId: 1, quantity: 1 }]);
    if (!("lines" in lowered)) throw new Error("refused");
    const breakdown = [{ vendorId: 1, vendorName: "Acme", destinationLabel: null, fee: "0.000" }];
    expect(deliveryAfter(breakdown, before, after, rules, false).added).toEqual([]); // 30 still clears it
    const next = deliveryAfter(breakdown, before, lowered.lines, rules, false); // 10 + 10 = 20
    expect(next.added).toEqual([{ vendorId: 1, vendorName: "Acme", destinationLabel: null, fee: "2.000", waived: false }]);
    expect(next.breakdown[0].fee).toBe("2.000");
    /* A member's is waived, as it was at the sale. */
    const member = deliveryAfter(breakdown, before, lowered.lines, rules, true);
    expect(member.breakdown[0]).toMatchObject({ fee: "0.000", waived: "2.000" });
  });

  it("never charges a door that was free for another reason, or one already paying", () => {
    const small = [line(1, { quantity: 1 }), line(2, { quantity: 1 })]; // 20, under 25: free because no fee was set then
    const lowered = linesAfter(unpaid, small, [{ lineId: 2, quantity: 0 }]);
    if (!("lines" in lowered)) throw new Error("refused");
    expect(deliveryAfter([{ vendorId: 1, vendorName: "Acme", destinationLabel: null, fee: "0.000" }], small, lowered.lines, rules, false).added).toEqual([]);
    expect(deliveryAfter([{ vendorId: 1, vendorName: "Acme", destinationLabel: null, fee: "2.000" }], small, lowered.lines, rules, false).added).toEqual([]);
  });
});

describe("a discount after a change", () => {
  it("comes off below its minimum, is a percentage of what remains, and never grows", () => {
    expect(discountAfter({ kind: "fixed", value: "5.000", minSpend: "40.000" }, "5.000", "30.000")).toBe("0.000");
    expect(discountAfter({ kind: "fixed", value: "5.000", minSpend: "20.000" }, "5.000", "30.000")).toBe("5.000");
    expect(discountAfter({ kind: "percent", value: "10", minSpend: null }, "6.000", "30.000")).toBe("3.000");
    expect(discountAfter({ kind: "percent", value: "10", minSpend: null }, "2.000", "30.000")).toBe("2.000");
    expect(discountAfter(null, "5.000", "3.000")).toBe("3.000");
    expect(discountAfter(null, "0.000", "3.000")).toBe("0.000");
  });
});

describe("the quote", () => {
  const order = (over: Partial<ChangeOrder> = {}): ChangeOrder => ({
    status: "pending_payment",
    grandTotal: "40.000",
    member: false,
    discountCode: null,
    discountValue: "0.000",
    pointsValue: "0.000",
    giftCardValue: "0.000",
    deliveryBreakdown: [{ vendorId: 1, vendorName: "Acme", destinationLabel: null, fee: "0.000" }],
    ...over,
  });
  const rules = new Map([[1, { flat: "2.000", freeOver: "25.000" }]]);

  it("restates the total so the driver collects exactly what is still coming", () => {
    const lines = [line(1), line(2, { quantity: 1 })];
    const done = quoteChange({ order: order(), lines, changes: [{ lineId: 1, quantity: 1 }], code: null, rules });
    if ("refused" in done) throw new Error(done.refused);
    expect(done.quote).toMatchObject({ owedBefore: "40.000", owedAfter: "22.000", giftCardBack: "0.000", pointsBack: "0.000" });
    expect(done.quote.addedFees.map(fee => fee.fee)).toEqual(["2.000"]);
    /* Read back the way every page reads it. */
    const owed = stillOwed({ grandTotal: done.write.grandTotal, deliveryBreakdown: done.write.breakdown }, done.lines.map(one => ({ ...one, choice: one.deliveryChoice })));
    expect(owed.owed).toBe("22.000");
  });

  it("takes a code off below its minimum, and gives back stored value that no longer fits", () => {
    const lines = [line(1), line(2, { quantity: 1 })]; // 40
    const coded = quoteChange({
      order: order({ grandTotal: "35.000", discountCode: "BIG", discountValue: "5.000" }),
      lines,
      changes: [{ lineId: 1, quantity: 0 }],
      code: { kind: "fixed", value: "5.000", minSpend: "30.000" },
      rules: new Map(),
    });
    if ("refused" in coded) throw new Error(coded.refused);
    expect(coded.quote).toMatchObject({ owedBefore: "35.000", owedAfter: "10.000", discountAfter: "0.000", codeLost: true });

    /* A gift card that paid for everything: what is not coming goes back to it. */
    const carded = quoteChange({
      order: order({ grandTotal: "0.000", giftCardValue: "40.000" }),
      lines,
      changes: [{ lineId: 1, quantity: 0 }],
      code: null,
      rules: new Map(),
    });
    if ("refused" in carded) throw new Error(carded.refused);
    expect(carded.quote).toMatchObject({ owedAfter: "0.000", giftCardBack: "30.000", pointsBack: "0.000" });
    expect(carded.write.giftCardValue).toBe("10.000");

    /* Points after the card: the card is spent last, so it gives back first. */
    const both = quoteChange({
      order: order({ grandTotal: "0.000", pointsValue: "15.000", giftCardValue: "25.000" }),
      lines,
      changes: [{ lineId: 1, quantity: 0 }],
      code: null,
      rules: new Map(),
    });
    if ("refused" in both) throw new Error(both.refused);
    expect(both.quote).toMatchObject({ owedAfter: "0.000", giftCardBack: "25.000", pointsBack: "5.000" });
  });

  it("adds up: what was owed less what changed is what is owed", () => {
    const lines = [line(1, { quantity: 5, unitPrice: "4.125" }), line(2, { quantity: 2, addon: "0.750" })];
    const goods = lines.reduce((sum, one) => sum + toFils(one.lineTotal), 0n);
    const placed = order({ grandTotal: (Number(goods) / 1000).toFixed(3) });
    for (const keep of [0, 1, 2, 3, 4]) {
      const done = quoteChange({ order: placed, lines, changes: [{ lineId: 1, quantity: keep }], code: null, rules: new Map() });
      if ("refused" in done) throw new Error(done.refused);
      const kept = done.lines.filter(one => one.fulfilment !== "cancelled").reduce((sum, one) => sum + toFils(one.lineTotal), 0n);
      expect(toFils(done.quote.owedAfter)).toBe(kept);
    }
  });
});
