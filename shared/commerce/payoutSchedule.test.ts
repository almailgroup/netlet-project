import { describe, expect, it } from "vitest";
import { dueWindow, payoutDue, settledAtFor, settlementKindFor } from "./payoutSchedule.js";

/* 2026-09-23 is a Wednesday; 25th Friday, 26th Saturday, 27th Sunday. */
const WED = new Date("2026-09-23T10:00:00Z");
const day = (date: Date) => date.toISOString().slice(0, 10);

describe("which schedule applies", () => {
  it("holds cash longer than card", () => {
    expect(settlementKindFor("cod")).toBe("cod");
    /* The slow path is the explicit one, so anything unknown settles fast
       rather than being silently held a fortnight. */
    expect(settlementKindFor("knet")).toBe("card");
    expect(settlementKindFor(null)).toBe("card");
  });

  it("gives cash fourteen business days and card one to three", () => {
    const cash = dueWindow("cod", WED);
    expect([day(cash.from), day(cash.to)]).toEqual(["2026-10-13", "2026-10-13"]);

    const card = dueWindow("card", WED);
    /* A window, not one date: collapsing "1 to 3" to its optimistic end is how
       a shop gets a reputation for paying late. */
    expect([day(card.from), day(card.to)]).toEqual(["2026-09-24", "2026-09-28"]);
  });

  /* Friday and Saturday are not working days, so calendar arithmetic lands on
     a weekend two times in five. */
  it("counts business days across the Kuwaiti weekend", () => {
    const card = dueWindow("card", new Date("2026-09-24T10:00:00Z")); // Thursday
    expect(day(card.from)).toBe("2026-09-27"); // Sunday, not Friday
  });
});

describe("when the clock starts", () => {
  /*
   * A cash order is placed when a shopper presses the button and the money
   * turns up days later. Counting from the press would promise a payout for
   * money NetLet does not hold.
   */
  it("starts when the cash was collected, not when the order was placed", () => {
    const at = settledAtFor({
      status: "paid",
      placedAt: new Date("2026-09-01T10:00:00Z"),
      paymentCollectedAt: new Date("2026-09-20T10:00:00Z"),
    });
    expect(day(at!)).toBe("2026-09-20");
  });

  it("falls back to the order date when nothing recorded a collection", () => {
    expect(day(settledAtFor({ status: "paid", placedAt: WED })!)).toBe("2026-09-23");
  });

  it("has not started at all while the order is unpaid", () => {
    expect(settledAtFor({ status: "pending_payment", placedAt: WED })).toBeNull();
  });
});

describe("where an order stands", () => {
  it("is unpaid while nothing has arrived", () => {
    expect(payoutDue({ status: "pending_payment", paymentMethod: "cod", placedAt: WED }, WED))
      .toEqual({ state: "unpaid" });
  });

  /* Money that went back is not a payout waiting to happen. */
  it("is not owed at all once refunded", () => {
    expect(payoutDue({ status: "refunded", paymentMethod: "cod", placedAt: WED }, WED))
      .toEqual({ state: "refunded" });
  });

  it("is held until the window opens", () => {
    const verdict = payoutDue({ status: "paid", paymentMethod: "cod", placedAt: WED }, WED);
    expect(verdict.state).toBe("held");
  });

  it("is due once the window opens", () => {
    const verdict = payoutDue(
      { status: "paid", paymentMethod: "card", placedAt: WED },
      new Date("2026-09-25T10:00:00Z"),
    );
    expect(verdict).toMatchObject({ state: "due", overdue: false });
  });

  /* A schedule that only ever shows comfortable numbers is one nobody
     believes. */
  it("says so when a due date has passed", () => {
    const verdict = payoutDue(
      { status: "paid", paymentMethod: "card", placedAt: WED },
      new Date("2026-10-20T10:00:00Z"),
    );
    expect(verdict).toMatchObject({ state: "due", overdue: true });
  });
});
