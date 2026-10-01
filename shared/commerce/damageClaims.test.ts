/**
 * Damage in transit, and who bears it (3.4.2).
 */
import { describe, expect, it } from "vitest";
import {
  amountRefusal,
  CLAIM_WINDOW_DAYS,
  claimCeiling,
  claimRefusal,
  evidenceRefusal,
  liabilityByCourier,
  paidLineIds,
} from "./damageClaims.js";

const day = 24 * 60 * 60 * 1000;
const arrivedAt = new Date("2026-09-10T10:00:00Z");
const soon = new Date(arrivedAt.getTime() + day);
const delivered = { courierId: 3, state: "delivered", arrivedAt };

describe("who may claim, and when", () => {
  /* A claim is against a delivery company; with none, nobody can bear it. */
  it("refuses a parcel the seller carried themselves", () => {
    expect(claimRefusal({ ...delivered, courierId: null }, "shopper", soon)).toBe("claims.noCourier");
  });

  it("refuses a parcel that never left the seller", () => {
    expect(claimRefusal({ courierId: 3, state: "preparing", arrivedAt: null }, "seller", soon)).toBe("claims.notCarried");
  });

  it("lets the shopper claim only once it has arrived", () => {
    const out = { courierId: 3, state: "shipped", arrivedAt: null };
    expect(claimRefusal(out, "shopper", soon)).toBe("claims.notArrived");
    expect(claimRefusal(delivered, "shopper", soon)).toBeNull();
  });

  /* The van was in an accident: the seller hears before the shopper does. */
  it("lets a seller or NetLet claim while the parcel is still out", () => {
    const out = { courierId: 3, state: "shipped", arrivedAt: null };
    expect(claimRefusal(out, "seller", soon)).toBeNull();
    expect(claimRefusal(out, "admin", soon)).toBeNull();
  });

  it("closes the window for everybody, administrators included", () => {
    const late = new Date(arrivedAt.getTime() + (CLAIM_WINDOW_DAYS + 1) * day);
    expect(claimRefusal(delivered, "shopper", late)).toBe("claims.windowClosed");
    expect(claimRefusal(delivered, "admin", late)).toBe("claims.windowClosed");
  });
});

describe("what a claim may be worth", () => {
  it("is capped by what the damaged lines were sold for", () => {
    const ceiling = claimCeiling([{ lineTotal: "240.000" }, { lineTotal: "22.500" }]);
    expect(ceiling).toBe("262.500");
    expect(amountRefusal("262.500", ceiling)).toBeNull();
    expect(amountRefusal("262.501", ceiling)).toBe("claims.overValue");
  });

  it("refuses nothing, a negative and anything that is not money", () => {
    for (const bad of ["0", "0.000", "-5", "abc", "1.2345", "", "1e3"]) {
      expect(amountRefusal(bad, "100.000")).toBe("claims.badAmount");
    }
  });
});

describe("evidence", () => {
  it("is optional, and a link must be https", () => {
    expect(evidenceRefusal(null)).toBeNull();
    expect(evidenceRefusal("https://photos.example/box.jpg")).toBeNull();
    expect(evidenceRefusal("http://photos.example/box.jpg")).toBe("claims.badEvidence");
    expect(evidenceRefusal("javascript:alert(1)")).toBe("claims.badEvidence");
    expect(evidenceRefusal("not a url")).toBe("claims.badEvidence");
  });
});

describe("what each company owes", () => {
  it("is the sum of its accepted awards, with open and rejected counted apart", () => {
    const ledger = liabilityByCourier([
      { courierId: 1, status: "accepted", awardedAmount: "100.000" },
      { courierId: 1, status: "accepted", awardedAmount: "22.500" },
      { courierId: 1, status: "open", awardedAmount: null },
      { courierId: 1, status: "rejected", awardedAmount: null },
      { courierId: 2, status: "open", awardedAmount: null },
      { courierId: null, status: "accepted", awardedAmount: "9.000" },
    ]);
    expect(ledger).toEqual([
      { courierId: 1, owed: "122.500", accepted: 2, open: 1, rejected: 1 },
      /* A liability nobody has decided is not one. */
      { courierId: 2, owed: "0.000", accepted: 0, open: 1, rejected: 0 },
    ]);
  });
});

describe("a line already paid for", () => {
  /* Claim-again is the answer to a rejection; after an acceptance it would be
     the same cushion compensated twice. */
  it("is the lines of accepted claims, and only those", () => {
    const paid = paidLineIds([
      { status: "accepted", lineIds: [4, 5] },
      { status: "rejected", lineIds: [6] },
      { status: "open", lineIds: [7] },
    ]);
    expect([...paid].sort()).toEqual([4, 5]);
  });
});
