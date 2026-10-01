/**
 * What an order still owes once part of it is not arriving.
 *
 * Found by cancelling one line of a real cash order: the driver was told to
 * collect KWD 267.400 for a delivery of cushions and olive oil, because the
 * board read the frozen grand total and the sofa in it had been cancelled.
 */
import { describe, expect, it } from "vitest";
import { isKept, stillOwed, type OwedLine } from "./collection.js";

const line = (over: Partial<OwedLine>): OwedLine => ({
  vendorId: 1, destinationLabel: null, lineTotal: "10.000", fulfilment: "pending", ...over,
});

describe("what an order still owes", () => {
  it("is the frozen total while every line is still coming", () => {
    const owed = stillOwed({ grandTotal: "267.400", deliveryBreakdown: null }, [
      line({ lineTotal: "240.000" }), line({ lineTotal: "22.500" }), line({ vendorId: 2, lineTotal: "4.900" }),
    ]);
    expect(owed).toEqual({ owed: "267.400", droppedGoods: "0.000", droppedDelivery: "0.000", reduced: false });
  });

  /* The case that was found: the sofa cancelled, the rest still coming. */
  it("drops a cancelled line's price and keeps its seller's delivery while other items still need it", () => {
    const owed = stillOwed(
      { grandTotal: "272.400", deliveryBreakdown: [{ vendorId: 1, vendorName: "Dar Home", destinationLabel: null, fee: "5.000" }] },
      [line({ lineTotal: "240.000", fulfilment: "cancelled" }), line({ lineTotal: "22.500" }), line({ vendorId: 2, lineTotal: "4.900" })],
    );
    expect(owed.owed).toBe("32.400");
    expect(owed.droppedDelivery).toBe("0.000");
    expect(owed.reduced).toBe(true);
  });

  /* A van that no longer has anything to carry is not charged for. */
  it("drops a seller's delivery fee once nothing of theirs is coming to that door", () => {
    const owed = stillOwed(
      { grandTotal: "41.500", deliveryBreakdown: [{ vendorId: 1, vendorName: "A", destinationLabel: null, fee: "2.000" }] },
      [line({ lineTotal: "39.500", fulfilment: "cancelled" })],
    );
    expect(owed).toEqual({ owed: "0.000", droppedGoods: "39.500", droppedDelivery: "2.000", reduced: true });
  });

  /* A parcel is a seller *and* a door (3.2.6): one door emptied, the other not. */
  it("drops the fee for one door and keeps it for the other", () => {
    const owed = stillOwed(
      {
        grandTotal: "26.000",
        deliveryBreakdown: [
          { vendorId: 1, vendorName: "A", destinationLabel: null, fee: "2.000" },
          { vendorId: 1, vendorName: "A", destinationLabel: "Mum's house", fee: "2.000" },
        ],
      },
      [line({ lineTotal: "10.000" }), line({ lineTotal: "12.000", destinationLabel: "Mum's house", fulfilment: "cancelled" })],
    );
    expect(owed.droppedGoods).toBe("12.000");
    expect(owed.droppedDelivery).toBe("2.000");
    expect(owed.owed).toBe("12.000");
  });

  /* `lineTotal` already carries the extras (`freezeLine`), so a line of
     100.000 with a 15.000 fitting is frozen at 115.000 and comes off once. The
     first draft subtracted the add-ons again and under-charged by the fitting. */
  it("drops a cancelled line's add-ons with it, once", () => {
    const owed = stillOwed({ grandTotal: "125.000", deliveryBreakdown: null }, [
      line({ lineTotal: "115.000", fulfilment: "cancelled" }), line({ lineTotal: "10.000" }),
    ]);
    expect(owed.owed).toBe("10.000");
    expect(owed.droppedGoods).toBe("115.000");
  });

  /* Order-level reductions stay whole, and the figure never becomes a debt. */
  it("keeps the whole discount and floors at zero rather than owing the shopper", () => {
    const owed = stillOwed({ grandTotal: "5.000", deliveryBreakdown: null }, [
      line({ lineTotal: "50.000", fulfilment: "cancelled" }), line({ lineTotal: "5.000" }),
    ]);
    expect(owed.owed).toBe("0.000");
  });

  it("treats a line sent back as not kept, the same as a cancelled one", () => {
    expect(isKept("returned")).toBe(false);
    expect(isKept("cancelled")).toBe(false);
    expect(isKept("delivered")).toBe(true);
    expect(stillOwed({ grandTotal: "20.000", deliveryBreakdown: null }, [
      line({ fulfilment: "returned" }), line({ fulfilment: "delivered" }),
    ]).owed).toBe("10.000");
  });
});
