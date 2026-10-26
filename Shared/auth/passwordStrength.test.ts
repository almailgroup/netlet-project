import { describe, expect, it } from "vitest";
import { checkPassword, MIN_PASSWORD_LENGTH } from "./passwordStrength.js";

describe("checkPassword", () => {
  it("treats an empty box as unanswered, not weak", () => {
    const verdict = checkPassword("");
    expect(verdict.score).toBe(0);
    expect(verdict.acceptable).toBe(false);
    // No point telling somebody their blank password lacks a symbol.
    expect(verdict.unmet).toEqual(["length", "case", "number", "symbol"]);
  });

  it("blocks anything under the floor, however varied", () => {
    const verdict = checkPassword("Aa1!Aa1");
    expect(verdict.unmet).toContain("length");
    expect(verdict.acceptable).toBe(false);
    // Eight, on the owner's word: the account form's floor.
    expect(MIN_PASSWORD_LENGTH).toBe(8);
    expect(checkPassword("Aa1!Aa1!").unmet).not.toContain("length");
  });

  it("rewards length over punctuation soup", () => {
    // The lesson the meter should teach: a long passphrase beats a short
    // scramble, and this is the assertion that keeps it honest.
    const passphrase = checkPassword("correct horse battery staple");
    const scramble = checkPassword("Xk9#mQ2$vZ");
    expect(passphrase.score).toBeGreaterThanOrEqual(scramble.score);
    expect(passphrase.acceptable).toBe(true);
  });

  it("collapses a common password whatever else it has", () => {
    const verdict = checkPassword("Password123!");
    expect(verdict.unmet).toContain("notCommon");
    expect(verdict.score).toBeLessThanOrEqual(1);
    expect(verdict.acceptable).toBe(false);
  });

  it("matches the core, not a substring", () => {
    // The bug this replaced: any passphrase containing "password" anywhere was
    // refused, which is wrong and pushes people toward something shorter.
    expect(checkPassword("correct horse password staple").acceptable).toBe(true);
    expect(checkPassword("my-kuwait-harbour-walk").acceptable).toBe(true);
    // Still caught, which is the whole point of the rule.
    expect(checkPassword("passw0rd").unmet).toContain("notCommon");
    expect(checkPassword("qwerty_1").unmet).toContain("notCommon");
  });

  it("catches a single repeated character and a digit run", () => {
    expect(checkPassword("aaaaaaaaaaaa").unmet).toContain("notCommon");
    expect(checkPassword("1234567890123").unmet).toContain("notCommon");
  });

  it("names what is missing rather than only scoring", () => {
    const verdict = checkPassword("lowercaseonly");
    expect(verdict.unmet).toContain("case");
    expect(verdict.unmet).toContain("number");
    expect(verdict.unmet).toContain("symbol");
    expect(verdict.unmet).not.toContain("length");
    // Advice, not a gate: this is still a usable password.
    expect(verdict.acceptable).toBe(true);
  });

  it("climbs through the bands as a password improves", () => {
    const bands = [
      checkPassword("sho1!Ab").band,
      checkPassword("reasonablepass").band,
      checkPassword("ReasonablePass1").band,
      checkPassword("ReasonablePassphrase1!").band,
    ];
    expect(bands[0]).toBe("weak");
    expect(bands[3]).toBe("strong");
    // Monotonic: each step is at least as good as the last.
    const order = { weak: 0, fair: 1, good: 2, strong: 3 };
    for (let i = 1; i < bands.length; i += 1) {
      expect(order[bands[i]]).toBeGreaterThanOrEqual(order[bands[i - 1]]);
    }
  });

  it("never scores outside the bar it draws", () => {
    for (const candidate of ["", "a", "aB1!", "x".repeat(200), "ReasonablePassphrase1!".repeat(5)]) {
      const { score } = checkPassword(candidate);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(4);
    }
  });
});
