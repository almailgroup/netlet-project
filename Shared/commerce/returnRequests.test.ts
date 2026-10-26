/**
 * Returns and exchanges, decided automatically where a rule can (3.5.2).
 */
import { describe, expect, it } from "vitest";
import { automaticDecision, isOpenReturn, refundFor, returnActions } from "./returnRequests.js";

describe("the automatic decision", () => {
  it.each(["damaged", "defective", "wrongItem", "notAsDescribed"] as const)("approves %s at once, whatever the department", reason => {
    expect(automaticDecision(reason, "grocery")).toEqual({ status: "approved", decidedBy: "auto" });
    expect(automaticDecision(reason, null).status).toBe("approved");
  });

  it("approves a change of mind", () => {
    expect(automaticDecision("changedMind", "electronics")).toEqual({ status: "approved", decidedBy: "auto" });
  });

  /* Perishables are the one change-of-mind a rule can refuse. */
  it("declines a change of mind on perishable groceries, saying why", () => {
    expect(automaticDecision("changedMind", "grocery")).toEqual({
      status: "declined", decidedBy: "auto", declineReason: "returns.perishableNoChangeOfMind",
    });
  });

  /* A gap in our catalogue is not the shopper's problem. */
  it("treats a product with no department as not perishable", () => {
    expect(automaticDecision("changedMind", null).status).toBe("approved");
  });

  it("leaves 'other' for the seller, because a rule cannot read it", () => {
    expect(automaticDecision("other", "electronics")).toEqual({ status: "requested", decidedBy: null });
  });
});

describe("what may be done next", () => {
  it("lets the shopper withdraw only before the item has left them", () => {
    expect(returnActions({ status: "requested", kind: "refund" }, "shopper")).toEqual(["cancel"]);
    expect(returnActions({ status: "approved", kind: "refund" }, "shopper")).toEqual(["cancel"]);
    expect(returnActions({ status: "collected", kind: "refund" }, "shopper")).toEqual([]);
  });

  it("walks the seller through decide, collect, receive and pay back", () => {
    expect(returnActions({ status: "requested", kind: "refund" }, "seller")).toEqual(["approve", "decline"]);
    expect(returnActions({ status: "approved", kind: "refund" }, "seller")).toEqual(["collect"]);
    /* What a rule approved the seller may dispute; what NetLet confirmed is settled. */
    expect(returnActions({ status: "approved", kind: "refund", decidedBy: "auto" }, "seller")).toEqual(["collect", "dispute"]);
    expect(returnActions({ status: "approved", kind: "refund", decidedBy: "seller" }, "seller")).toEqual(["collect"]);
    expect(returnActions({ status: "review", kind: "refund" }, "seller")).toEqual([]);
    expect(returnActions({ status: "review", kind: "refund" }, "admin")).toEqual(["approve", "decline"]);
    expect(returnActions({ status: "review", kind: "refund" }, "shopper")).toEqual(["cancel"]);
    expect(returnActions({ status: "collected", kind: "exchange" }, "seller")).toEqual(["receive"]);
    expect(returnActions({ status: "refunded", kind: "refund", refundPaidAt: null }, "seller")).toEqual(["markRefundPaid"]);
    expect(returnActions({ status: "refunded", kind: "refund", refundPaidAt: new Date() }, "seller")).toEqual([]);
  });

  /* An approval a seller could be argued out of needs somebody above both. */
  it("lets only an administrator overrule an approval", () => {
    expect(returnActions({ status: "approved", kind: "refund" }, "admin")).toContain("decline");
    expect(returnActions({ status: "approved", kind: "refund" }, "seller")).not.toContain("decline");
  });

  it("does nothing to a finished request", () => {
    for (const status of ["declined", "exchanged", "cancelled"]) {
      expect(returnActions({ status, kind: "refund" }, "admin")).toEqual([]);
    }
  });
});

describe("the refund", () => {
  it("is the line's frozen total, add-ons included", () => {
    expect(refundFor({ lineTotal: "88.125" })).toBe("88.125");
  });

  it("knows which states are still open", () => {
    expect(["requested", "approved", "collected"].every(isOpenReturn)).toBe(true);
    expect(["declined", "refunded", "exchanged", "cancelled"].some(isOpenReturn)).toBe(false);
  });
});
