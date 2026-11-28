import { describe, expect, it } from "vitest";
import { journeyStage, journeyStep, maskedCardCode, receiptFileName, receiptMethod, receiptPayment, receiptRows, type ReceiptOrder } from "./orderReceipt.js";

const plain: ReceiptOrder = {
  status: "pending_payment",
  paymentMethod: "cod",
  itemsTotal: "39.900",
  deliveryTotal: "1.500",
  grandTotal: "41.400",
  discountCode: null,
  discountValue: "0.000",
  pointsSpent: 0,
  pointsValue: "0.000",
  giftCardCode: null,
  giftCardValue: "0.000",
};

describe("journeyStep", () => {
  it("places an item on the tracker's four steps, and nowhere once it left the road", () => {
    expect(journeyStep({ kind: "received" })).toBe(0);
    expect(journeyStep({ kind: "preparing" })).toBe(1);
    expect(journeyStep({ kind: "onTheWay" })).toBe(2);
    expect(journeyStep({ kind: "partlyDelivered" })).toBe(2);
    expect(journeyStep({ kind: "delivered" })).toBe(3);
    expect(journeyStep({ kind: "cancelled" })).toBeNull();
    expect(journeyStep({ kind: "returned" })).toBeNull();
  });
});

describe("journeyStage", () => {
  it("puts every progress on one of five stages", () => {
    expect(journeyStage({ kind: "received" })).toBe("processing");
    expect(journeyStage({ kind: "preparing" })).toBe("processing");
    expect(journeyStage({ kind: "onTheWay" })).toBe("onTheWay");
    expect(journeyStage({ kind: "partlyDelivered" })).toBe("onTheWay");
    expect(journeyStage({ kind: "delivered" })).toBe("delivered");
    expect(journeyStage({ kind: "cancelled" })).toBe("cancelled");
    expect(journeyStage({ kind: "returned" })).toBe("returned");
  });
});

describe("receiptRows", () => {
  it("prints the goods, delivery and the total for a plain order", () => {
    expect(receiptRows(plain, null)).toEqual([
      { kind: "subtotal", amount: "39.900" },
      { kind: "delivery", amount: "1.500" },
      { kind: "total", amount: "41.400", strong: true },
    ]);
  });

  it("says free delivery rather than leaving it out", () => {
    expect(receiptRows({ ...plain, deliveryTotal: "0.000", grandTotal: "39.900" }, null)[1]).toEqual({ kind: "delivery", amount: "0.000", free: true });
  });

  it("keeps the till's order: tax, then the code, the points and the card", () => {
    const rows = receiptRows(
      {
        ...plain,
        discountCode: "SAVE5",
        discountValue: "2.000",
        pointsSpent: 1500,
        pointsValue: "1.500",
        giftCardCode: "GIFT-ABCD-9F2K",
        giftCardValue: "5.000",
        grandTotal: "34.895",
      },
      { amount: "1.995", rate: "5" },
    );
    expect(rows.map(row => row.kind)).toEqual(["subtotal", "delivery", "tax", "discount", "points", "giftCard", "total"]);
    expect(rows[2].params).toEqual({ rate: "5" });
    expect(rows[3]).toMatchObject({ minus: true, params: { code: "SAVE5" } });
    expect(rows[4]).toMatchObject({ minus: true, params: { points: "1500" } });
    /* The card's code is a bearer value: only its last four characters. */
    expect(rows[5]).toMatchObject({ minus: true, params: { code: "•••• 9F2K" } });
  });

  it("prints no reduction that took nothing, and no tax of nothing", () => {
    expect(receiptRows(plain, { amount: "0.000", rate: "5" }).map(row => row.kind)).toEqual(["subtotal", "delivery", "total"]);
  });
});

describe("receiptPayment", () => {
  it("reads the order's own state first", () => {
    expect(receiptPayment({ ...plain, status: "paid" }, "0.000")).toEqual({ kind: "paid" });
    expect(receiptPayment({ ...plain, status: "refunded" }, "41.400")).toEqual({ kind: "refunded" });
    expect(receiptPayment({ ...plain, status: "cancelled" }, "41.400")).toEqual({ kind: "cancelled" });
  });

  it("says a cash order is paid at the door, less what was cancelled", () => {
    expect(receiptPayment(plain, "41.400")).toEqual({ kind: "onDelivery", amount: "41.400", reduced: false });
    expect(receiptPayment(plain, "30.000")).toEqual({ kind: "onDelivery", amount: "30.000", reduced: true });
    expect(receiptPayment(plain, "0.000")).toEqual({ kind: "nothingDue" });
  });

  it("says an order paid online instead owes the driver nothing", () => {
    expect(receiptPayment({ ...plain, paymentMethod: "knet" }, "41.400")).toEqual({ kind: "paidOnline" });
  });
});

describe("the receipt's words and name", () => {
  it("names how it was paid", () => {
    expect(receiptMethod("cod")).toBe("cod");
    expect(receiptMethod(null)).toBe("cod");
    expect(receiptMethod("knet")).toBe("knet");
    expect(receiptMethod("card")).toBe("card");
    expect(receiptMethod("apple_pay")).toBe("applePay");
  });

  it("masks a card code and names the file by the order", () => {
    expect(maskedCardCode("AB")).toBe("AB");
    expect(maskedCardCode("GIFT-1234")).toBe("•••• 1234");
    expect(receiptFileName("NL-20261012-3NJA9")).toBe("NetLet-receipt-NL-20261012-3NJA9.pdf");
    expect(receiptFileName("NL/../x")).toBe("NetLet-receipt-NLx.pdf");
  });
});
