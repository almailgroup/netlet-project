import { describe, expect, it } from "vitest";
import { AREAS } from "./kuwaitAddress";
import { blockOf, fillFromPlace, matchArea, matchGovernorate, placeFromHints, streetOf, type PlaceHints } from "./placeParts";

/* The hints OpenStreetMap's answers make (suburb and county as areas,
   neighbourhood as the block, the ISO code and the state as the governorate),
   taken from real answers at these points, read by the Live check workflow. */
const osm = (address: Record<string, string>): PlaceHints => ({
  roads: [address.road].filter(Boolean),
  blocks: [address.neighbourhood, address.quarter].filter(Boolean),
  areas: [address.suburb, address.county].filter(Boolean),
  governorates: [address["ISO3166-2-lvl4"], address.state].filter(Boolean),
  houses: [address.house_number].filter(Boolean),
});

describe("placeFromHints — real OpenStreetMap answers", () => {
  it("Salmiya, English: the area beside its block, a named street", () => {
    const place = placeFromHints(osm({ road: "Hamad Al-Mubarak Street", neighbourhood: "Salmiya - Block 5", suburb: "Salmiya", county: "Salmiya", state: "Hawalli Governorate", "ISO3166-2-lvl4": "KW-HA" }));
    expect(place).toEqual({ parts: { area: "Salmiya", block: "5", street: "Hamad Al-Mubarak" }, governorate: "hawalli" });
  });

  it("Salmiya, Arabic: the same area, block and street", () => {
    const place = placeFromHints(osm({ road: "شارع حمد المبارك", neighbourhood: "السالمية - قطعة 5", suburb: "السالمية", county: "السالمية", state: "محافظة حولي", "ISO3166-2-lvl4": "KW-HA" }));
    expect(place).toEqual({ parts: { area: "Salmiya", block: "5", street: "حمد المبارك" }, governorate: "hawalli" });
  });

  it("Rumaithiya: a numbered street and the house the pin is on", () => {
    const place = placeFromHints(osm({ house_number: "6A", road: "Street 52", neighbourhood: "Block 5", suburb: "Rumaithiya", county: "Rumaithiya", state: "Hawalli Governorate", "ISO3166-2-lvl4": "KW-HA" }));
    expect(place?.parts).toEqual({ area: "Rumaithiya", block: "5", street: "52", building: "6A" });
  });

  it("Yarmouk: a street with a lane is a street and an avenue, in both languages", () => {
    expect(placeFromHints(osm({ house_number: "13", road: "Street 3 Lane 1", neighbourhood: "Yarmouk - Block 4", suburb: "Yarmouk", "ISO3166-2-lvl4": "KW-KU" }))?.parts)
      .toEqual({ area: "Yarmouk", block: "4", street: "3", avenue: "1", building: "13" });
    expect(placeFromHints(osm({ house_number: "13", road: "شارع 3 جادة 1", neighbourhood: "اليرموك - قطعة 4", suburb: "اليرموك", "ISO3166-2-lvl4": "KW-KU" }))?.parts)
      .toEqual({ area: "Yarmouk", block: "4", street: "3", avenue: "1", building: "13" });
  });

  it("spellings the service has of its own: Mishrif, Hawally, Eqaila, Qurtuba, Al-Qurain", () => {
    expect(placeFromHints(osm({ neighbourhood: "Block 7", suburb: "Mishrif", county: "Mishref", "ISO3166-2-lvl4": "KW-HA" }))?.parts.area).toBe("Mishref");
    expect(placeFromHints(osm({ neighbourhood: "Hawally - Block 5", suburb: "Hawally", "ISO3166-2-lvl4": "KW-HA" }))?.parts).toEqual({ area: "Hawalli", block: "5" });
    expect(placeFromHints(osm({ road: "Street 245", neighbourhood: "Eqaila - Block 5", suburb: "Eqaila", county: "Eqaila", "ISO3166-2-lvl4": "KW-AH" }))?.parts).toEqual({ area: "Egaila", block: "5", street: "245" });
    expect(placeFromHints(osm({ house_number: "122", road: "Street 1", neighbourhood: "Qurtuba - Block 2", suburb: "Qurtuba", county: "Qortuba", "ISO3166-2-lvl4": "KW-KU" }))?.parts.area).toBe("Qortuba");
    expect(placeFromHints(osm({ road: "Street 201", neighbourhood: "Block 4", suburb: "Al-Qurain", county: "Qurain", "ISO3166-2-lvl4": "KW-MU" }))?.parts.area).toBe("Qurain");
  });

  it("a longer name containing the list's: Abdullah Mubarak Al-Sabah", () => {
    expect(placeFromHints(osm({ road: "Street 10", neighbourhood: "Abdullah Mubarak Al-Sabah Block 7", suburb: "Abdullah Mubarak Al-Sabah", "ISO3166-2-lvl4": "KW-FA" }))?.parts)
      .toEqual({ area: "Abdullah Al-Mubarak", block: "7", street: "10" });
    expect(placeFromHints(osm({ road: "شارع 10", neighbourhood: "عبدالله المبارك الصباح قطعة 7", suburb: "عبدالله المبارك الصباح", "ISO3166-2-lvl4": "KW-FA" }))?.parts.area)
      .toBe("Abdullah Al-Mubarak");
  });

  it("المنطقة الوسطي is Wista, and the governorate comes from the code", () => {
    expect(placeFromHints(osm({ suburb: "المنطقة الوسطي", state: "محافظة مبارك الكبير", "ISO3166-2-lvl4": "KW-MU" })))
      .toEqual({ parts: { area: "Wista" }, governorate: "mubarak-al-kabeer" });
  });

  it("Jahra's Road 3 stays a road, not Street 3", () => {
    expect(placeFromHints(osm({ road: "Road 3", neighbourhood: "Waha - Block 3", suburb: "Waha", "ISO3166-2-lvl4": "KW-JA" }))?.parts)
      .toEqual({ area: "Waha", block: "3", street: "Road 3" });
  });

  it("an area off the list is kept as the service wrote it", () => {
    const place = placeFromHints({ roads: [], blocks: ["Block 1"], areas: ["Shuwaikh Industrial 3"], governorates: ["KW-KU"], houses: [] });
    expect(place?.parts.area).toBe("Shuwaikh Industrial 3");
    expect(place?.governorate).toBe("capital");
  });

  it("nothing usable is null", () => {
    expect(placeFromHints({ roads: [], blocks: [], areas: [], governorates: [], houses: [] })).toBeNull();
  });
});

describe("the pieces", () => {
  it("reads a block however it is written", () => {
    expect(blockOf("Salmiya - Block 5")).toBe("5");
    expect(blockOf("قطعة ٧")).toBe("7");
    expect(blockOf("Block No. 12")).toBe("12");
    expect(blockOf("Blk 3a")).toBe("3A");
    expect(blockOf("4")).toBe("4");
    expect(blockOf("Salmiya")).toBeNull();
  });

  it("reads a street and its avenue", () => {
    expect(streetOf("Street 52")).toEqual({ street: "52" });
    expect(streetOf("St. 5")).toEqual({ street: "5" });
    expect(streetOf("Lane 4")).toEqual({ avenue: "4" });
    expect(streetOf("Jadda 2")).toEqual({ avenue: "2" });
    expect(streetOf("Prince Saud Al-Faisal Al-Saud Street")).toEqual({ street: "Prince Saud Al-Faisal Al-Saud" });
    expect(streetOf("شارع ١٢")).toEqual({ street: "12" });
  });

  it("names a governorate by code, English or Arabic", () => {
    expect(matchGovernorate("KW-AH")).toBe("ahmadi");
    expect(matchGovernorate("Capital Governorate")).toBe("capital");
    expect(matchGovernorate("Al Asimah")).toBe("capital");
    expect(matchGovernorate("Mubarak al-Kabir Governorate")).toBe("mubarak-al-kabeer");
    expect(matchGovernorate("محافظة العاصمة")).toBe("capital");
    expect(matchGovernorate("محافظة الفروانية")).toBe("farwaniya");
    expect(matchGovernorate("Basra")).toBeNull();
  });

  it("never guesses between two real places", () => {
    /* Dasma and Dasman are both in the capital; "Dasmaa" is one letter from each. */
    expect(matchArea("Dasmaa")).toBeNull();
    expect(matchArea("Dasma")?.en).toBe("Dasma");
    expect(matchArea("Dasman")?.en).toBe("Dasman");
    /* Salwa is two letters from Salam: too far for a five-letter name. */
    expect(matchArea("Salwa")?.en).toBe("Salwa");
    expect(matchArea("Salwah")?.en).toBe("Salwa");
  });

  it("finds every area on the list by its own names, in both languages, and no other", () => {
    for (const [governorate, list] of Object.entries(AREAS)) {
      for (const area of list) {
        expect(matchArea(area.en)?.en, area.en).toBe(area.en);
        expect(matchArea(area.ar)?.en, area.ar).toBe(area.en);
        expect(matchArea(area.ar, governorate)?.en, area.ar).toBe(area.en);
      }
    }
  });

  it("does not take Hawalli for Maidan Hawalli", () => {
    expect(matchArea("Maidan Hawalli")?.en).toBe("Maidan Hawalli");
    expect(matchArea("Hawalli")?.en).toBe("Hawalli");
  });
});

describe("fillFromPlace", () => {
  const place = { parts: { area: "Salmiya", block: "5", street: "52", building: "6A" }, governorate: "hawalli" };

  it("fills an empty form and its governorate", () => {
    const fill = fillFromPlace({}, null, place, []);
    expect(fill.parts).toEqual({ area: "Salmiya", block: "5", street: "52", building: "6A" });
    expect(fill.governorate).toBe("hawalli");
    expect(fill.filled).toEqual(["area", "block", "street", "building"]);
    expect(fill.conflicts).toEqual([]);
  });

  it("keeps what the shopper typed and names where the pin disagrees", () => {
    const fill = fillFromPlace({ area: "Salmiya", block: "7", building: "12", floor: "2" }, "hawalli", place, []);
    expect(fill.parts).toEqual({ area: "Salmiya", block: "7", street: "52", building: "12", floor: "2" });
    expect(fill.conflicts).toEqual(["block", "building"]);
    expect(fill.filled).toEqual(["area", "street"]);
  });

  it("takes the pin's over what was typed when asked to", () => {
    const fill = fillFromPlace({ block: "7" }, "capital", place, [], true);
    expect(fill.parts.block).toBe("5");
    expect(fill.governorate).toBe("hawalli");
    expect(fill.conflicts).toEqual([]);
  });

  it("rewrites what an earlier pin wrote, and empties what this one has no answer for", () => {
    const first = fillFromPlace({}, null, place, []);
    const second = fillFromPlace(first.parts, first.governorate, { parts: { area: "Jabriya", block: "2", street: "Hamad Bin Mubarak Al-Mi'na'i" }, governorate: "hawalli" }, first.filled);
    expect(second.parts).toEqual({ area: "Jabriya", block: "2", street: "Hamad Bin Mubarak Al-Mi'na'i", building: "" });
    expect(second.conflicts).toEqual([]);
  });

  it("leaves a chosen governorate alone unless the pin wrote the area", () => {
    expect(fillFromPlace({ area: "Typed" }, "capital", place, []).governorate).toBe("capital");
    expect(fillFromPlace({}, "capital", place, []).governorate).toBe("hawalli");
  });
});
