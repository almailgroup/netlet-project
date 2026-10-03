import { describe, expect, it } from "vitest";
import { batchFor, maskIban, type Obligation } from "./payoutRuns.js";

const window = { from: new Date("2026-09-01"), to: new Date("2026-09-01") };
const due = { state: "due", window, overdue: false } as const;
const held = { state: "held", window } as const;
const ob = (orderId: number, earnedFils: bigint, state: Obligation["due"] = due): Obligation => ({ orderId, reference: `NL-${orderId}`, earnedFils, due: state });

describe("a seller's batch", () => {
  it("is every order that has come due and not been paid", () => {
    const batch = batchFor([ob(2, 5000n), ob(1, 3000n), ob(3, 9000n, held)], new Map());
    expect(batch.lines.map(line => [line.orderId, line.amountFils, line.kind])).toEqual([[1, 3000n, "payout"], [2, 5000n, "payout"]]);
    expect(batch).toMatchObject({ totalFils: 8000n, payable: true });
  });

  it("does not pay an order twice", () => {
    expect(batchFor([ob(1, 3000n)], new Map([[1, 3000n]])).lines).toEqual([]);
  });

  it("takes back a refund already paid out, even before anything else is due", () => {
    /* Paid 5.000, then a line came back and the order now earns 2.000. */
    const batch = batchFor([ob(1, 2000n, { state: "refunded" }), ob(2, 4000n, held)], new Map([[1, 5000n]]));
    expect(batch.lines).toEqual([{ orderId: 1, reference: "NL-1", amountFils: -3000n, kind: "clawback" }]);
    expect(batch).toMatchObject({ totalFils: -3000n, payable: false });
  });

  it("nets a clawback against what is due", () => {
    const batch = batchFor([ob(1, 0n, { state: "refunded" }), ob(2, 7000n)], new Map([[1, 2000n]]));
    expect(batch).toMatchObject({ totalFils: 5000n, payable: true });
  });
});

describe("a masked IBAN", () => {
  it("keeps the country and the last four", () => {
    expect(maskIban("KW81 CBKU 0000 0000 0000 1234 5601 01")).toBe("KW•••• 0101");
    expect(maskIban(null)).toBeNull();
  });
});
