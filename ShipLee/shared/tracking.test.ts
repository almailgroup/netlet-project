import { describe, expect, it } from "vitest";
import { checkDigit, makeTrackingNumber, parseTrackingNumber } from "./tracking.js";

describe("a tracking number", () => {
  const good = `SL482061937${checkDigit("482061937")}`;

  it("reads however it was typed", () => {
    const digits = good.slice(2);
    for (const typed of [good, good.toLowerCase(), digits, `SL ${digits.slice(0, 4)} ${digits.slice(4)}`, `sl-${digits}`, ` ${good} `]) {
      expect(parseTrackingNumber(typed)).toEqual({ ok: true, number: good });
    }
  });

  it("reads Arabic-Indic digits as digits", () => {
    const arabic = good.slice(2).replace(/\d/g, d => String.fromCharCode(0x0660 + Number(d)));
    expect(parseTrackingNumber(`SL${arabic}`)).toEqual({ ok: true, number: good });
    const persian = good.slice(2).replace(/\d/g, d => String.fromCharCode(0x06f0 + Number(d)));
    expect(parseTrackingNumber(persian)).toEqual({ ok: true, number: good });
  });

  it("says what is wrong with one that is not", () => {
    expect(parseTrackingNumber("")).toEqual({ ok: false, reason: "empty" });
    expect(parseTrackingNumber("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseTrackingNumber("SL12345")).toEqual({ ok: false, reason: "shape" });
    expect(parseTrackingNumber("AB1234567890")).toEqual({ ok: false, reason: "shape" });
    expect(parseTrackingNumber("SL12345678901")).toEqual({ ok: false, reason: "shape" });
  });

  it("catches every single wrong digit and every swap of two neighbours", () => {
    const digits = good.slice(2);
    for (let i = 0; i < digits.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === digits[i]) continue;
        const wrong = digits.slice(0, i) + d + digits.slice(i + 1);
        expect(parseTrackingNumber(wrong).ok, wrong).toBe(false);
      }
    }
    for (let i = 0; i < digits.length - 1; i++) {
      if (digits[i] === digits[i + 1]) continue;
      /* Luhn misses only 09 ↔ 90, which this number does not hold. */
      const swapped = digits.slice(0, i) + digits[i + 1] + digits[i] + digits.slice(i + 2);
      expect(parseTrackingNumber(swapped).ok, swapped).toBe(false);
    }
  });

  it("is made with a valid check digit and never starts with 0", () => {
    let seed = 0;
    const digits = [0, 0, 3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
    const make = () => makeTrackingNumber(() => digits[seed++ % digits.length]!);
    for (let i = 0; i < 20; i++) {
      const made = make();
      expect(made).toMatch(/^SL[1-9]\d{9}$/);
      expect(parseTrackingNumber(made)).toEqual({ ok: true, number: made });
    }
  });
});
