import { describe, expect, it } from "vitest";
import { MAX_PARCELS, parseTrackingList } from "./tracking.js";

describe("several numbers in one box", () => {
  it("reads one number typed with spaces as one", () => {
    expect(parseTrackingList("SL 4820 6193 79")).toEqual({ numbers: ["SL4820619379"], problems: [] });
  });

  it("splits on commas, the Arabic comma, semicolons and lines", () => {
    expect(parseTrackingList("SL4820619379, sl7315028469؛SL2658194705\nSL9173402588").numbers).toEqual(["SL4820619379", "SL7315028469", "SL2658194705", "SL9173402588"]);
    expect(parseTrackingList("SL4820619379، SL7315028469").numbers).toEqual(["SL4820619379", "SL7315028469"]);
  });

  it("splits on spaces only when every piece is a whole number", () => {
    expect(parseTrackingList("SL4820619379 SL7315028469").numbers).toEqual(["SL4820619379", "SL7315028469"]);
    expect(parseTrackingList("SL4820619379 hello")).toEqual({ numbers: [], problems: ["SL4820619379 hello"] });
  });

  it("keeps each number once and says what is not a number", () => {
    expect(parseTrackingList("SL4820619379, SL4820619379, SL1234567890")).toEqual({ numbers: ["SL4820619379"], problems: ["SL1234567890"] });
  });

  it("reads Arabic-Indic digits", () => {
    expect(parseTrackingList("SL٤٨٢٠٦١٩٣٧٩").numbers).toEqual(["SL4820619379"]);
  });

  it("has a ceiling a page can show", () => {
    expect(MAX_PARCELS).toBe(10);
  });
});
