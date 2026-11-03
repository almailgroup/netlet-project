import { describe, expect, it } from "vitest";
import { claimStage, problemIssue, responseIssue, warrantyActions, warrantyEligibility } from "./warranty.js";

const delivered = { fulfilment: "delivered", deliveredAt: "2026-10-01T10:00:00Z" };

describe("warranty claims", () => {
  it("is open on something delivered and not already being returned or claimed", () => {
    expect(warrantyEligibility(delivered, [], [])).toEqual({ allowed: true });
    expect(warrantyEligibility({ fulfilment: "shipped", deliveredAt: null }, [], [])).toEqual({ allowed: false, reason: "warranty.notDelivered" });
    expect(warrantyEligibility({ fulfilment: "returned", deliveredAt: delivered.deliveredAt }, [], [])).toEqual({ allowed: false, reason: "warranty.returned" });
    expect(warrantyEligibility(delivered, [{ status: "accepted" }], [])).toEqual({ allowed: false, reason: "warranty.openClaim" });
    expect(warrantyEligibility(delivered, [{ status: "declined" }, { status: "withdrawn" }], [])).toEqual({ allowed: true });
    expect(warrantyEligibility(delivered, [], [{ status: "approved" }])).toEqual({ allowed: false, reason: "warranty.openReturn" });
    expect(warrantyEligibility(delivered, [], [{ status: "exchanged" }])).toEqual({ allowed: false, reason: "warranty.returned" });
  });

  it("asks for words a store can act on, and never contact details", () => {
    expect(problemIssue("broken")).toBe("warranty.tooShort");
    expect(problemIssue("x".repeat(1001))).toBe("warranty.tooLong");
    expect(problemIssue("Stopped charging — email me at noura@example.com")).toBe("warranty.contactDetails");
    expect(problemIssue("The screen flickers after ten minutes of use.")).toBeNull();
    expect(responseIssue("", true)).toBe("warranty.needsReason");
    expect(responseIssue("", false)).toBeNull();
  });

  it("offers each side only what it may do, and reads a return's progress through", () => {
    expect(warrantyActions({ status: "open", remedy: null }, "shopper")).toEqual(["withdraw"]);
    expect(warrantyActions({ status: "open", remedy: null }, "store")).toEqual(["accept", "decline"]);
    expect(warrantyActions({ status: "accepted", remedy: "repair" }, "store")).toEqual(["complete"]);
    expect(warrantyActions({ status: "accepted", remedy: "refund" }, "store")).toEqual([]);
    expect(claimStage({ status: "accepted", remedy: "refund" }, "approved")).toBe("returning");
    expect(claimStage({ status: "accepted", remedy: "refund" }, "refunded")).toBe("done");
    expect(claimStage({ status: "accepted", remedy: "repair" }, null)).toBe("repairing");
    expect(claimStage({ status: "open", remedy: null }, null)).toBe("waiting");
  });
});
