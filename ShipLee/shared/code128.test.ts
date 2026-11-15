import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { bars, encodable, modules, PATTERNS } from "./code128.js";
import { makeTrackingNumber } from "./tracking.js";

/* jsbarcode is a test-time check only: the label draws its own bars. */
const JsBarcode = createRequire(import.meta.url)("jsbarcode") as (target: object, text: string, options: object) => void;
function theirs(text: string, format: string): string {
  const out: { encodings?: { data: string }[] } = {};
  JsBarcode(out, text, { format });
  return out.encodings!.map(encoding => encoding.data).join("");
}

describe("Code 128", () => {
  it("has 107 symbols of 11 modules each, three bars and three spaces, and a 13-module stop", () => {
    expect(PATTERNS).toHaveLength(107);
    expect(new Set(PATTERNS).size).toBe(107);
    PATTERNS.slice(0, 106).forEach(pattern => {
      expect(pattern).toHaveLength(6);
      expect([...pattern].reduce((sum, width) => sum + Number(width), 0)).toBe(11);
    });
    expect([...PATTERNS[106]].reduce((sum, width) => sum + Number(width), 0)).toBe(13);
  });

  it("draws every printable character in set B as jsbarcode does", () => {
    let printable = "";
    for (let code = 32; code < 127; code++) printable += String.fromCharCode(code);
    for (let at = 0; at < printable.length; at += 12) {
      const text = printable.slice(at, at + 12);
      expect(modules(text, "B"), text).toBe(theirs(text, "CODE128B"));
    }
  });

  it("draws every pair of digits in set C as jsbarcode does", () => {
    for (let at = 0; at < 100; at += 10) {
      const text = Array.from({ length: 10 }, (_, k) => String(at + k).padStart(2, "0")).join("");
      expect(modules(text, "C"), text).toBe(theirs(text, "CODE128C"));
    }
  });

  it("sets a tracking number in B for SL and C for the digits, as jsbarcode's own choice does", () => {
    let seed = 7;
    const digit = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 10;
    for (let k = 0; k < 40; k++) {
      const number = makeTrackingNumber(digit);
      expect(modules(number), number).toBe(theirs(number, "CODE128"));
    }
    /* Start B, S, L, switch to C, five pairs, check: 10 symbols of 11 and a stop of 13. */
    expect(modules("SL4820619379")).toHaveLength(10 * 11 + 13);
  });

  it("gives the bars as runs that add up to the drawing", () => {
    const line = modules("SL4820619379");
    const drawn = bars("SL4820619379");
    expect(drawn.reduce((sum, bar) => sum + bar.width, 0)).toBe([...line].filter(bit => bit === "1").length);
    expect(drawn[0]).toEqual({ x: 0, width: 2 });
  });

  it("refuses what it cannot carry", () => {
    expect(encodable("")).toBe(false);
    expect(encodable("رقم")).toBe(false);
    expect(() => modules("SL٤٨")).toThrow();
    expect(() => modules("123", "C")).toThrow();
  });
});
