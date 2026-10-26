import { describe, expect, it } from "vitest";
import {
  acceptableReferral, balanceOf, canCashOut, cashOutValue, MIN_CASH_OUT_POINTS,
  pointsSpendableOn, referralCodeFor, spendValue, userIdFromCode,
} from "./referral.js";

describe("the ledger", () => {
  /* Never stored: a balance beside the entries is two records of one fact. */
  it("is the sum of the entries and nothing else", () => {
    expect(balanceOf([
      { reason: "referred_welcome", points: 250 },
      { reason: "referrer_bonus", points: 500 },
      { reason: "spent_on_order", points: -300 },
    ])).toBe(450);
  });

  it("is zero for somebody with no history", () => {
    expect(balanceOf([])).toBe(0);
  });

  it("can go negative if an adjustment says so, rather than hiding it", () => {
    expect(balanceOf([{ reason: "admin_adjustment", points: -50 }])).toBe(-50);
  });
});

describe("what points are worth", () => {
  it("spends at a fil each inside NetLet", () => {
    expect(spendValue(1500)).toBe("1.500");
    expect(spendValue(0)).toBe("0.000");
  });

  /*
   * The document's rule (3.1.15): face value less a 10% cash-collection fee.
   * It paid a tenth for a long time, which kept nine-tenths of what was earned.
   */
  it("cashes out at face value less the 10% fee", () => {
    expect(cashOutValue(1000)).toBe("0.900");
    expect(cashOutValue(5000)).toBe("4.500");
  });

  /* Rounding a payout up invents money. */
  it("rounds a payout down rather than up", () => {
    expect(cashOutValue(1009)).toBe("0.908");
  });

  it("never pays out a negative balance", () => {
    expect(cashOutValue(-500)).toBe("0.000");
    expect(spendValue(-500)).toBe("0.000");
  });
});

describe("cashing out", () => {
  it("needs a balance worth the trouble, and says how far short", () => {
    expect(canCashOut(MIN_CASH_OUT_POINTS)).toEqual({ ok: true });
    expect(canCashOut(400)).toEqual({ ok: false, shortBy: MIN_CASH_OUT_POINTS - 400 });
  });
});

describe("spending on an order", () => {
  /* Points are a discount, not a deposit: paying more than the total would
     leave the shop owing change on a payment that never happened. */
  it("never covers more than the order", () => {
    expect(pointsSpendableOn(9000, "2.000")).toBe(2000);
    expect(pointsSpendableOn(500, "2.000")).toBe(500);
    expect(pointsSpendableOn(-5, "2.000")).toBe(0);
  });
});

describe("the code", () => {
  it("round-trips an account id", () => {
    for (const id of [1, 7, 42, 1234, 99999]) {
      expect(userIdFromCode(referralCodeFor(id))).toBe(id);
    }
  });

  /*
   * Read out loud far more often than an order number, so the same alphabet:
   * no O or 0, no I, 1 or L, no S or 5. The check is on the *body*, because
   * the "NL" is the brand and carries an L the way `NL-20260915-QRTVW` does —
   * a fixed prefix is never the character anybody mishears.
   */
  it("uses only characters people do not mishear", () => {
    for (const id of [1, 12345, 99999, 500000]) {
      expect(referralCodeFor(id).slice(2)).not.toMatch(/[OIL015S]/);
    }
  });

  it("is case and prefix forgiving, because somebody types it", () => {
    const code = referralCodeFor(88);
    expect(userIdFromCode(code.toLowerCase())).toBe(88);
    expect(userIdFromCode(`  ${code}  `)).toBe(88);
  });

  it("answers null for something that is not a code", () => {
    expect(userIdFromCode("")).toBeNull();
    expect(userIdFromCode("NL!!!!")).toBeNull();
    expect(userIdFromCode("hello there")).toBeNull();
  });
});

describe("who may refer whom", () => {
  /*
   * Refusing self-referral is the whole of the fraud model enforceable without
   * identity NetLet does not have. Pretending to more would be theatre.
   */
  it("refuses somebody referring themselves", () => {
    expect(acceptableReferral(7, 7)).toBe(false);
    expect(acceptableReferral(7, 8)).toBe(true);
    expect(acceptableReferral(0, 8)).toBe(false);
  });
});

describe("referral commissions (3.1.14, 3.1.15)", () => {
  it("is the rate on NetLet's commission, rounded down, never more than it", async () => {
    const { referralSharePoints } = await import("./referral.js");
    expect(referralSharePoints("1.200", "20.00")).toBe(240);
    expect(referralSharePoints("0.007", "20.00")).toBe(1);
    expect(referralSharePoints("0.004", "20.00")).toBe(0);
    expect(referralSharePoints("1.000", "100.00")).toBe(1000);
    expect(referralSharePoints("0.000", "50.00")).toBe(0);
  });

  it("matures at the end of the return window from arrival, or from collection while unknown", async () => {
    const { maturesAt } = await import("./referral.js");
    const collected = new Date("2026-10-01T10:00:00Z");
    expect(maturesAt(null, collected, 14).toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(maturesAt("2026-10-03T10:00:00Z", collected, 14).toISOString()).toBe("2026-10-17T10:00:00.000Z");
  });

  it("counts only what has matured, and says what is held", async () => {
    const { balanceOf, heldOf } = await import("./referral.js");
    const now = new Date("2026-10-10T00:00:00Z");
    const entries = [
      { reason: "referrer_bonus" as const, points: 500 },
      { reason: "product_referral" as const, points: 240, availableAt: "2026-10-20T00:00:00Z" },
      { reason: "invite_commission" as const, points: 120, availableAt: "2026-10-05T00:00:00Z" },
      { reason: "product_referral_reversal" as const, points: -240, availableAt: "2026-10-20T00:00:00Z" },
    ];
    expect(balanceOf(entries, now)).toBe(620);
    expect(heldOf(entries, now)).toBe(0);
    expect(heldOf(entries.slice(0, 3), now)).toBe(240);
  });
});
