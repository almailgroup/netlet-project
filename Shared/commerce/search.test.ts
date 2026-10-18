import { describe, expect, it } from "vitest";
import {
  brandsMatching,
  correctionFor,
  departmentsMatching,
  editDistance,
  foldText,
  highlightParts,
  matchesSearch,
  queryWords,
  rankBySearch,
  rankDocs,
  searchScore,
  searchWords,
  stemWord,
  tokensOf,
  type SearchDoc,
} from "./search.js";
import type { Product } from "./types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    handle: id,
    title: id,
    description: "",
    descriptionHtml: "",
    productType: null,
    vendor: null,
    tags: [],
    attributes: [],
    images: [],
    options: [],
    priceRange: { min: money("10"), max: money("10") },
    variants: [{ id: `${id}-v`, title: "Default", sku: null, price: money("10"), compareAtPrice: null, availableForSale: true, selectedOptions: [] }],
    ...overrides,
  } as Product;
}

const brand = (value: string) => ({ namespace: "specs", key: "brand", label: "Brand", value });

const phone = product("galaxy", { title: "Samsung Galaxy S26 Ultra phone", productType: "Electronics", vendor: "Phone store Hawally", attributes: [brand("Samsung")] });
const processor = product("processor", { title: "Philips food processor", productType: "Home & Kitchen", vendor: "Phone store Hawally", attributes: [brand("Philips")] });
const holder = product("holder", { title: "Car mount", productType: "Electronics", description: "Holds any phone on the dashboard." });
const shade = product("shade", { title: "Linen lampshade", productType: "Home & Kitchen" });
const lamp = product("lamp", { title: "Brass lamp", productType: "Home & Kitchen" });

describe("what a search finds", () => {
  it("never matches on the seller's name", () => {
    expect(matchesSearch(processor, "phone")).toBe(false);
    expect(matchesSearch(processor, "hawally")).toBe(false);
    expect(matchesSearch(phone, "phone")).toBe(true);
  });

  it("ranks the title above the brand above the description", () => {
    expect(rankBySearch([holder, processor, phone], "phone").map(p => p.id)).toEqual(["galaxy", "holder"]);
    expect(searchScore(phone, "phone")).toBeGreaterThan(searchScore(holder, "phone"));
  });

  it("puts a whole word ahead of a word it starts", () => {
    expect(rankBySearch([shade, lamp], "lamp").map(p => p.id)).toEqual(["lamp", "shade"]);
  });

  it("needs every word, found somewhere", () => {
    expect(matchesSearch(lamp, "brass lamp")).toBe(true);
    expect(matchesSearch(shade, "brass lamp")).toBe(false);
  });

  it("finds a product by its department in either language", () => {
    expect(matchesSearch(holder, "electronics")).toBe(true);
    expect(matchesSearch(holder, "إلكترونيات")).toBe(true);
  });

  it("reads Arabic-Indic digits as digits", () => {
    expect(tokensOf("S٢٦")).toEqual(["s26"]);
  });
});

describe("a misspelling", () => {
  it("counts a swap as one edit", () => {
    expect(editDistance("samsng", "samsung")).toBe(1);
    expect(editDistance("smasung", "samsung")).toBe(1);
    expect(editDistance("lamp", "lamp")).toBe(0);
  });

  it("is corrected to the catalogue's own spelling", () => {
    expect(correctionFor("samsng", [phone, processor])).toBe("Samsung");
    expect(correctionFor("philps processor", [phone, processor])).toBe("Philips processor");
  });

  it("is left alone when it is a real word, or when nothing is close", () => {
    expect(correctionFor("samsung", [phone])).toBeNull();
    expect(correctionFor("zzqx", [phone])).toBeNull();
    /* Too short to guess at: "tv" is one edit from far too much. */
    expect(correctionFor("ty", [phone])).toBeNull();
  });
});

describe("words compared as people mean them", () => {
  it("folds the Arabic letter forms keyboards and spellers disagree on, and the marks", () => {
    expect(foldText("أإآٱ")).toBe("اااا");
    expect(foldText("ساعة")).toBe("ساعه");
    expect(foldText("مستشفى")).toBe("مستشفي");
    expect(foldText("مُكيّف")).toBe("مكيف");
    expect(foldText("مـــكيف")).toBe("مكيف");
    expect(foldText("S٢٦ ۱۲")).toBe("s26 12");
  });

  it("takes the article and the sound plural off an Arabic word, and the plural off an English one", () => {
    expect(searchWords("الساعة")).toEqual(["ساعه"]);
    expect(searchWords("والهواتف للبيع")).toEqual(["هواتف", "بيع"]);
    expect(stemWord("ساعات")).toBe("ساع");
    /* A short word is not eaten: "ال" alone, "الة". */
    expect(stemWord("ال")).toBe("ال");
    expect(searchWords("watches batteries battery cookies cookie phones glasses")).toEqual(["watch", "batteri", "batteri", "cooki", "cooki", "phon", "glass"]);
    expect(searchWords("bus 65W S26")).toEqual(["bus", "65w", "s26"]);
  });

  it("finds a product whichever way the shopper spells it", () => {
    const watch = product("watch", { title: "ساعة ذكية", productType: "Electronics" });
    for (const term of ["ساعه", "الساعة", "ساعات", "الساعات"]) expect(matchesSearch(watch, term)).toBe(true);
    const sofa = product("sofa", { title: "Three-seat sofas" });
    expect(matchesSearch(sofa, "sofa")).toBe(true);
    expect(matchesSearch(lamp, "lamps")).toBe(true);
  });
});

describe("the shopper's own word", () => {
  it("finds the seller's word through a synonym, in either language", () => {
    expect(matchesSearch(phone, "جوال")).toBe(true);
    expect(matchesSearch(phone, "mobile")).toBe(true);
    expect(matchesSearch(product("sofa", { title: "Three-seat sofa" }), "قنفة")).toBe(true);
    expect(matchesSearch(product("rice", { title: "Basmati rice 5kg" }), "عيش")).toBe(true);
  });

  it("ranks the word typed above a synonym of it", () => {
    const named = product("named", { title: "Mobile holder" });
    const synonym = product("synonym", { title: "Phone holder" });
    expect(rankBySearch([synonym, named], "mobile holder").map(p => p.id)).toEqual(["named", "synonym"]);
  });

  it("expands only a whole word, never a fragment", () => {
    expect(queryWords("ph")[0].synonyms).toEqual([]);
    expect(queryWords("phone")[0].synonyms).toContain("جوال");
  });
});

describe("a document from the server", () => {
  it("is found by its title in the other language", () => {
    const doc: SearchDoc = { title: "Smart watch", alternateTitle: "ساعة ذكية", tags: [], variants: [] };
    /* "ذكية" is no synonym of anything, so only the Arabic title can answer it. */
    expect(rankDocs([doc], item => item, "ذكية")).toEqual([doc]);
    expect(rankDocs([{ ...doc, alternateTitle: null }], item => item, "ذكية")).toEqual([]);
  });
});

describe("what the dropdown draws", () => {
  it("marks the words searched for, matched as the search matches", () => {
    expect(highlightParts("Smart watch", "watches")).toEqual([
      { text: "Smart", hit: false }, { text: " ", hit: false }, { text: "watch", hit: true },
    ]);
    expect(highlightParts("ساعة ذكية", "الساعات").filter(part => part.hit).map(part => part.text)).toEqual(["ساعة"]);
    expect(highlightParts("Smart watch", "")).toEqual([{ text: "Smart watch", hit: false }]);
  });

  it("names a department from either language, and a brand the shop sells", () => {
    expect(departmentsMatching("elec").map(d => d.slug)).toEqual(["electronics"]);
    expect(departmentsMatching("بقالة").map(d => d.slug)).toEqual(["grocery"]);
    expect(departmentsMatching("zzz")).toEqual([]);
    expect(brandsMatching("sams", ["Samsung", "Philips"])).toEqual(["Samsung"]);
  });
});
