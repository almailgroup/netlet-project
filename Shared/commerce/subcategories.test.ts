import { describe, expect, it } from "vitest";
import { DEPARTMENTS } from "./departments.js";
import { searchWords } from "./search.js";
import { findSubcategory, SUBCATEGORIES, SUBCATEGORY_ICONS, subcategoriesOf, subcategoryFor, typeOptions } from "./subcategories.js";
import { ATTRIBUTE_SCHEMA, fieldFor, shownOption } from "./attributeSchema.js";

const file = (department: string, title: string, extra: { tags?: string[]; type?: string; titleAr?: string } = {}) =>
  subcategoryFor({ department, titles: [title, extra.titleAr ?? null], tags: extra.tags ?? [], type: extra.type ?? null });

describe("subcategoryFor", () => {
  it("files a product by the words its titles hold", () => {
    expect(file("Grocery", "Basmati rice 5 kg")).toBe("pantry");
    expect(file("Grocery", "Medjool dates")).toBe("snacks");
    expect(file("Style", "Cotton dishdasha")).toBe("men");
    expect(file("Style", "Leather sandals")).toBe("shoes");
    expect(file("Electronics", "Samsung Galaxy S26 Ultra, 12GB RAM")).toBe("phones");
    expect(file("Electronics", "Harbour Wireless Earbuds")).toBe("audio");
    expect(file("Home & Kitchen", "Terrace Planter Trio")).toBe("decor");
  });

  it("reads the Arabic title as well, folded and stemmed as search reads it", () => {
    expect(file("Electronics", "Wireless pro", { titleAr: "سماعات لاسلكية" })).toBe("audio");
    expect(file("Beauty", "Royal", { titleAr: "عطر العود الملكي" })).toBe("fragrance");
    expect(file("Grocery", "Ajwa", { titleAr: "التمور المدينة" })).toBe("snacks");
  });

  it("counts a tag when the titles say nothing", () => {
    expect(file("Electronics", "Model X200", { tags: ["tablet"] })).toBe("tablets");
    /* A title's word counts twice a tag's: one tag does not outvote it, three do. */
    expect(file("Electronics", "Phone X", { tags: ["charger"] })).toBe("phones");
    expect(file("Electronics", "Phone stand", { tags: ["charger", "cable", "case"] })).toBe("accessories");
  });

  it("takes the seller's own Type first, by its name in either language or its slug", () => {
    expect(file("Electronics", "Galaxy phone", { type: "Accessories" })).toBe("accessories");
    expect(file("Electronics", "Galaxy phone", { type: "الإكسسوارات" })).toBe("accessories");
    expect(file("Electronics", "Galaxy phone", { type: "tablets" })).toBe("tablets");
    /* A Type naming nothing in this department falls back to the words. */
    expect(file("Electronics", "Galaxy phone", { type: "Shoes" })).toBe("phones");
  });

  it("files nothing outside a department, or with no word it knows", () => {
    expect(file("Pet supplies", "Dog bed")).toBeNull();
    expect(subcategoryFor({ department: null, titles: ["Phone"], tags: [] })).toBeNull();
    expect(file("Electronics", "Mystery gadget")).toBeNull();
  });

  it("settles a tie on the first listed", () => {
    /* "phone" is phones' and "case" accessories': one title word each. */
    expect(file("Electronics", "Phone case")).toBe("phones");
  });
});

describe("the subcategory list", () => {
  it("covers every department, with slugs unique within each", () => {
    for (const department of DEPARTMENTS) {
      const entries = subcategoriesOf(department.slug);
      expect(entries.length, department.slug).toBeGreaterThanOrEqual(4);
      expect(new Set(entries.map(entry => entry.slug)).size).toBe(entries.length);
      expect(entries.every(entry => entry.name && entry.nameAr && entry.words.length)).toBe(true);
    }
    expect(Object.keys(SUBCATEGORIES).sort()).toEqual(DEPARTMENTS.map(department => department.slug).sort());
  });

  it("gives each subcategory of a department its own picture", () => {
    for (const [department, entries] of Object.entries(SUBCATEGORIES)) {
      expect(new Set(entries.map(entry => entry.icon)).size, department).toBe(entries.length);
      for (const entry of entries) expect(SUBCATEGORY_ICONS, entry.slug).toContain(entry.icon);
    }
  });

  it("never gives one word to two subcategories of a department, so a word files one place", () => {
    for (const [department, entries] of Object.entries(SUBCATEGORIES)) {
      const owner = new Map<string, string>();
      for (const entry of entries) {
        for (const word of entry.words) {
          const key = searchWords(word).join(" ");
          const seen = owner.get(key);
          expect(seen === undefined || seen === entry.slug, `${department}: "${word}" is ${seen}'s and ${entry.slug}'s`).toBe(true);
          owner.set(key, entry.slug);
        }
      }
    }
  });

  it("files every word under its own subcategory, as a title alone", () => {
    for (const department of DEPARTMENTS) {
      for (const entry of subcategoriesOf(department.slug)) {
        for (const word of entry.words) expect(file(department.name, word), `${department.slug}: ${word}`).toBe(entry.slug);
      }
    }
  });

  it("finds a subcategory by its department and slug", () => {
    expect(findSubcategory("electronics", "phones")?.nameAr).toBe("الهواتف");
    expect(findSubcategory("electronics", "shoes")).toBeNull();
    expect(findSubcategory(null, "phones")).toBeNull();
  });
});

describe("the Type row", () => {
  it("is first in every department's rows, offering its subcategories by name", () => {
    for (const department of DEPARTMENTS) {
      const [first] = ATTRIBUTE_SCHEMA[department.slug];
      expect(first.key).toBe("type");
      expect(first.options).toEqual(typeOptions(department.slug).options);
      expect(first.optionsAr).toHaveLength(first.options!.length);
    }
  });

  it("is read in the page's language", () => {
    const field = fieldFor("electronics", "type");
    expect(shownOption(field, "Mobile phones", true)).toBe("الهواتف");
    expect(shownOption(field, "mobile phones", true)).toBe("الهواتف");
    expect(shownOption(field, "Mobile phones", false)).toBe("Mobile phones");
    /* Anything a seller typed that is not an option stays as written. */
    expect(shownOption(field, "Feature phone", true)).toBe("Feature phone");
  });
});
