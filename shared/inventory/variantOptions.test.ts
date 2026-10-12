import { describe, expect, it } from "vitest";
import { optionPairs, optionPairsProblem, optionsDistinguish, optionsRecord, varyingOptionNames } from "./variantOptions";

describe("variant options", () => {
  it("saves what was typed, trimmed, and drops a wholly blank row", () => {
    expect(optionsRecord([{ name: " Colour ", value: " Black " }, { name: "", value: "" }])).toEqual({ Colour: "Black" });
    expect(optionPairs({ Colour: "Black", Storage: "256 GB" })).toEqual([
      { name: "Colour", value: "Black" },
      { name: "Storage", value: "256 GB" },
    ]);
  });

  it("refuses half a row and a name used twice, whatever its case", () => {
    expect(optionPairsProblem([{ name: "Colour", value: "" }])).toBe("admin.optionHalf");
    expect(optionPairsProblem([{ name: "", value: "Black" }])).toBe("admin.optionHalf");
    expect(optionPairsProblem([{ name: "Colour", value: "Black" }, { name: "colour", value: "Red" }])).toBe("admin.optionDuplicate");
    expect(optionPairsProblem([{ name: "C".repeat(61), value: "x" }])).toBe("admin.optionTooLong");
    expect(optionPairsProblem([{ name: "", value: "" }, { name: "Colour", value: "Black" }])).toBeNull();
  });

  it("tells variants apart only when every one has every varying option and no two match", () => {
    const phones = [
      { Colour: "Black", Storage: "128 GB" },
      { Colour: "Black", Storage: "256 GB" },
      { Colour: "Blue", Storage: "128 GB" },
    ];
    expect(varyingOptionNames(phones)).toEqual(["Colour", "Storage"]);
    expect(optionsDistinguish(phones)).toBe(true);
    /* A shared fact is not a choice. */
    expect(varyingOptionNames([{ Material: "Steel", Colour: "Black" }, { Material: "Steel", Colour: "Red" }])).toEqual(["Colour"]);
    /* One variant has no value for an option that varies. */
    expect(optionsDistinguish([{ Colour: "Black" }, { Colour: "Red" }, {}])).toBe(false);
    /* Two share a combination. */
    expect(optionsDistinguish([{ Colour: "Black" }, { Colour: "Black" }, { Colour: "Red" }])).toBe(false);
    /* Nothing to tell apart. */
    expect(optionsDistinguish([{ Colour: "Black" }])).toBe(false);
    expect(optionsDistinguish([{}, {}])).toBe(false);
  });
});
