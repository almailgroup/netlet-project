import { describe, expect, it } from "vitest";
import {
  fieldsFor, freeFormRows, mergeAttributes, unitFor, valueOf, type Attribute,
} from "./attributeSchema.js";

const rating: Attribute = { namespace: "reviews", key: "rating", label: "Rating", value: "4.5" };
const custom: Attribute = { namespace: "spec", key: "boxcontents", label: "In the box", value: "Cable, manual" };
const ram: Attribute = { namespace: "spec", key: "ram", label: "Memory", value: "16" };

describe("what a department expects", () => {
  it("offers the rows for a department it knows", () => {
    expect(fieldsFor("electronics").map(f => f.key)).toContain("ram");
    expect(fieldsFor("grocery").map(f => f.key)).toContain("origin");
  });

  /* A department with no schema is fine: the rows stay free-form. */
  it("offers nothing for one it does not", () => {
    expect(fieldsFor("sporting-goods")).toEqual([]);
    expect(fieldsFor(null)).toEqual([]);
  });

  /* "16 GB" from one seller and "16" from another is the same split the keys
     exist to stop, so the unit belongs to the field. */
  it("keeps the unit on the field rather than in the value", () => {
    expect(unitFor("electronics", "ram")).toBe("GB");
    expect(unitFor("electronics", "brand")).toBeNull();
  });
});

describe("reading what a seller recorded", () => {
  it("finds a schema value by key", () => {
    expect(valueOf([ram], "ram")).toBe("16");
    expect(valueOf([ram], "storage")).toBe("");
  });

  /* A seller who recorded something the schema does not offer keeps it. */
  it("separates free-form rows from the schema's, and leaves the score out", () => {
    expect(freeFormRows([rating, ram, custom], "electronics")).toEqual([custom]);
  });
});

describe("writing them back", () => {
  it("fills the schema rows and keeps everything else untouched", () => {
    const next = mergeAttributes([rating, custom], "electronics", { ram: "32", brand: "Acme" });
    expect(next).toContainEqual(rating);
    expect(next).toContainEqual(custom);
    expect(next.filter(r => r.namespace === "spec" && r.key === "ram")).toEqual([
      { namespace: "spec", key: "ram", label: "Memory", value: "32" },
    ]);
  });

  /*
   * A schema that deletes merchant data on first save is one nobody uses
   * twice.
   */
  it("does not drop a row the schema knows nothing about", () => {
    const next = mergeAttributes([custom], "electronics", {});
    expect(next).toEqual([custom]);
  });

  /* "" renders as a label with nothing after it, which reads as a shop that
     lost the value rather than one that never had it. */
  it("clears a row rather than storing a blank", () => {
    const next = mergeAttributes([ram], "electronics", { ram: "   " });
    expect(next.some(r => r.key === "ram")).toBe(false);
  });

  it("trims what it stores", () => {
    const next = mergeAttributes([], "electronics", { brand: "  Acme  " });
    expect(next[0].value).toBe("Acme");
  });

  it("replaces rather than duplicates on a second save", () => {
    const once = mergeAttributes([], "electronics", { ram: "16" });
    const twice = mergeAttributes(once, "electronics", { ram: "32" });
    expect(twice.filter(r => r.key === "ram")).toHaveLength(1);
    expect(valueOf(twice, "ram")).toBe("32");
  });
});
