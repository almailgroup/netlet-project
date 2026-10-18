import { describe, expect, it } from "vitest";
import { addressLineIn, addressProblems } from "./addresses";
import { AREAS, areaLabel, cleanParts, composeAddressLine, governorateOfArea, missingParts, partsProblems } from "./kuwaitAddress";

const salmiya = { area: "Salmiya", block: "4", street: "Baghdad St", avenue: "", building: "15", floor: "2", apartment: "5" };

describe("a Kuwaiti address as its parts", () => {
  it("reads as a driver reads it, in either language", () => {
    expect(composeAddressLine(salmiya)).toBe("Salmiya, Block 4, Street Baghdad St, House 15, Floor 2, Apartment 5");
    expect(composeAddressLine(salmiya, true)).toBe("السالمية، قطعة 4، شارع Baghdad St، منزل 15، الدور 2، شقة 5");
    expect(composeAddressLine({ ...salmiya, paciNumber: "12345678" })).toMatch(/, PACI 12345678$/);
  });

  it("folds Arabic-Indic digits, trims and drops blanks", () => {
    expect(cleanParts({ block: " ٤ ", floor: "۲", avenue: "  ", paciNumber: "1234 5678" })).toEqual({ block: "4", floor: "2", paciNumber: "12345678" });
    expect(cleanParts({ area: "", block: " " })).toBeNull();
  });

  it("needs the area, block, street and house, and a PACI number of eight digits", () => {
    expect(missingParts({ area: "Salmiya", block: "4" })).toEqual(["street", "building"]);
    expect(missingParts(salmiya)).toEqual([]);
    expect(partsProblems({ ...salmiya, paciNumber: "1234" })).toEqual(["address.badPaci"]);
    expect(partsProblems({ ...salmiya, block: "12345678901" })).toEqual(["address.partTooLong"]);
  });

  it("names an area on the list in Arabic and knows its governorate", () => {
    expect(areaLabel("Salmiya", true)).toBe("السالمية");
    expect(areaLabel("Somewhere new", true)).toBe("Somewhere new");
    expect(governorateOfArea("Jabriya")).toBe("hawalli");
    expect(governorateOfArea("Somewhere new")).toBeNull();
    /* No area is listed under two governorates. */
    const all = Object.values(AREAS).flat().map(area => area.en);
    expect(new Set(all).size).toBe(all.length);
  });

  it("is an address on its own, and an address with only a line still is one", () => {
    expect(addressProblems({ label: "Home", parts: salmiya })).toEqual([]);
    expect(addressProblems({ label: "Home", parts: { area: "Salmiya" } })).toEqual(["address.needsParts"]);
    expect(addressProblems({ label: "Home", addressLine: "Block 4, Street 12" })).toEqual([]);
    expect(addressProblems({ label: "Home" })).toEqual(["address.needsLine"]);
    expect(addressLineIn({ addressLine: "old line", parts: salmiya }, true)).toMatch(/^السالمية/);
    expect(addressLineIn({ addressLine: "old line", parts: null }, true)).toBe("old line");
  });
});
