import { describe, expect, it } from "vitest";
import { MAX_LINE_QUANTITY } from "./types.js";
import { cardCeiling, lineCeiling, quantityDraft, roomFor, shortLines, typedQuantity } from "./typedQuantity.js";

describe("typedQuantity", () => {
  it("reads a whole number as the line's quantity", () => {
    expect(typedQuantity("9")).toEqual({ kind: "set", quantity: 9, capped: false });
    expect(typedQuantity(" 12 ")).toEqual({ kind: "set", quantity: 12, capped: false });
    expect(typedQuantity("007")).toEqual({ kind: "set", quantity: 7, capped: false });
  });

  it("folds Arabic-Indic digits", () => {
    expect(typedQuantity("١٢")).toEqual({ kind: "set", quantity: 12, capped: false });
    expect(typedQuantity("۵")).toEqual({ kind: "set", quantity: 5, capped: false });
  });

  it("takes the line out at zero, as the bin does", () => {
    expect(typedQuantity("0")).toEqual({ kind: "remove" });
    expect(typedQuantity("٠")).toEqual({ kind: "remove" });
  });

  it("holds a number over the ceiling to it and says so", () => {
    expect(typedQuantity(String(MAX_LINE_QUANTITY + 1))).toEqual({ kind: "set", quantity: MAX_LINE_QUANTITY, capped: true });
    expect(typedQuantity("5000", 99)).toEqual({ kind: "set", quantity: 99, capped: true });
    expect(typedQuantity(String(MAX_LINE_QUANTITY))).toEqual({ kind: "set", quantity: MAX_LINE_QUANTITY, capped: false });
  });

  it("changes nothing for what is not a whole number", () => {
    for (const text of ["", "  ", "2.5", "-3", "two", "1e3", "12345", "3 4"]) expect(typedQuantity(text)).toBeNull();
  });
});

describe("quantityDraft", () => {
  it("keeps only digits, Latin, at most four", () => {
    expect(quantityDraft("1a2")).toBe("12");
    expect(quantityDraft("٣٤")).toBe("34");
    expect(quantityDraft("123456")).toBe("1234");
    expect(quantityDraft("-")).toBe("");
  });
});

describe("lineCeiling", () => {
  const line = (lineId: string, variantId: string, quantity: number, maxQuantity?: number) => ({ lineId, variantId, quantity, maxQuantity });

  it("is what the shelf holds, held to the line ceiling", () => {
    const lamps = line("1", "v1", 2, 28);
    expect(lineCeiling(lamps, [lamps])).toBe(28);
    const plenty = line("1", "v1", 2, 500);
    expect(lineCeiling(plenty, [plenty])).toBe(MAX_LINE_QUANTITY);
  });

  it("leaves out what the bag's other lines of the same variant take", () => {
    const plain = line("1", "v1", 3, 10);
    const withFitting = line("2", "v1", 4, 10);
    const other = line("3", "v2", 9, 10);
    expect(lineCeiling(plain, [plain, withFitting, other])).toBe(6);
    expect(lineCeiling(withFitting, [plain, withFitting, other])).toBe(7);
  });

  it("is never below one, and the ceiling alone for a line with no figure", () => {
    const gone = line("1", "v1", 2, 0);
    expect(lineCeiling(gone, [gone])).toBe(1);
    const old = line("1", "v1", 2);
    expect(lineCeiling(old, [old])).toBe(MAX_LINE_QUANTITY);
  });
});

describe("shortLines", () => {
  it("names each line of a variant the bag asks too many of, with how many there are", () => {
    const short = shortLines([
      { lineId: "1", variantId: "v1", quantity: 20, maxQuantity: 28 },
      { lineId: "2", variantId: "v1", quantity: 10, maxQuantity: 28 },
      { lineId: "3", variantId: "v2", quantity: 3, maxQuantity: 3 },
      { lineId: "4", variantId: "v3", quantity: 1, maxQuantity: 0 },
      { lineId: "5", variantId: "v4", quantity: 50 },
    ]);
    expect([...short]).toEqual([["1", 28], ["2", 28], ["4", 0]]);
  });
});

describe("roomFor and cardCeiling", () => {
  it("leaves what the bag already holds of the variant", () => {
    expect(roomFor(28, 0)).toBe(28);
    expect(roomFor(28, 25)).toBe(3);
    expect(roomFor(28, 28)).toBe(1);
    expect(roomFor(500, 0)).toBe(MAX_LINE_QUANTITY);
  });

  it("is the plain line's own ceiling once it is in the bag", () => {
    const variant = { id: "v1", maxQuantity: 10 };
    const plain = { lineId: "1", variantId: "v1", quantity: 2 };
    const fitted = { lineId: "2", variantId: "v1", quantity: 3, maxQuantity: 10 };
    expect(cardCeiling(variant, undefined, [fitted])).toBe(7);
    expect(cardCeiling(variant, plain, [plain, fitted])).toBe(7);
    expect(cardCeiling(undefined, undefined, [])).toBe(MAX_LINE_QUANTITY);
  });
});
