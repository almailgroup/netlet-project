import { describe, expect, it } from "vitest";
import { MAX_LINE_QUANTITY } from "./types.js";
import { quantityDraft, typedQuantity } from "./typedQuantity.js";

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
