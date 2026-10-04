import { describe, expect, it } from "vitest";
import { MAX_SUPPORT_MESSAGE, firstAnswer, messageProblem, nextStatus } from "./support.js";

describe("a conversation's state", () => {
  it("waits on whoever has not answered, and reopens when the shopper writes again", () => {
    expect(nextStatus("open", "staffWrote")).toBe("waiting");
    expect(nextStatus("waiting", "shopperWrote")).toBe("open");
    expect(nextStatus("resolved", "shopperWrote")).toBe("open");
    expect(nextStatus("open", "resolved")).toBe("resolved");
  });
});

describe("a message", () => {
  it("is neither blank nor endless", () => {
    expect(messageProblem("  ")).toBe("support.empty");
    expect(messageProblem("x".repeat(MAX_SUPPORT_MESSAGE + 1))).toBe("support.tooLong");
    expect(messageProblem("Where is my sofa?")).toBeNull();
  });
});

describe("the automatic first answer", () => {
  const order = {
    reference: "NL-20261004-QRTVW",
    paymentMethod: "cod",
    paid: false,
    lines: [
      { fulfilment: "shipped" as const, returnable: false },
      { fulfilment: "preparing" as const, returnable: false },
      { fulfilment: "delivered" as const, returnable: true },
    ],
  };

  it("says where each part of the order is, and points at tracking when something is on the road", () => {
    const parts = firstAnswer("delivery", { order, returnWindowDays: 14 });
    expect(parts[0]).toEqual({ key: "support.answerOrderStatus", params: { reference: order.reference, preparing: "1", onTheWay: "1", delivered: "1" } });
    expect(parts.map(part => part.key)).toContain("support.answerTrack");
    expect(parts.at(-1)?.key).toBe("support.answerPerson");
  });

  it("asks which order when none was chosen, rather than guessing", () => {
    expect(firstAnswer("order", { returnWindowDays: 14 }).map(part => part.key)).toEqual(["support.answerChooseOrder", "support.answerPerson"]);
  });

  it("says a return is open only when one actually is", () => {
    expect(firstAnswer("return", { order, returnWindowDays: 14 })[0].key).toBe("support.answerReturnOpen");
    const closed = { ...order, lines: order.lines.map(line => ({ ...line, returnable: false })) };
    expect(firstAnswer("return", { order: closed, returnWindowDays: 14 })[0]).toEqual({ key: "support.answerReturnClosed", params: { reference: order.reference, days: "14" } });
    expect(firstAnswer("return", { returnWindowDays: 14 })[0]).toEqual({ key: "support.answerReturnPolicy", params: { days: "14" } });
  });

  it("states the cash rule, and whether this order's cash was collected", () => {
    expect(firstAnswer("payment", { order, returnWindowDays: 14 }).map(part => part.key)).toEqual(["support.answerPayment", "support.answerUnpaid", "support.answerPerson"]);
  });

  it("only promises a person on a question no rule reads", () => {
    expect(firstAnswer("other", { returnWindowDays: 14 }).map(part => part.key)).toEqual(["support.answerPerson"]);
  });
});
