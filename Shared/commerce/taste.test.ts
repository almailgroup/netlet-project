import { describe, expect, it } from "vitest";
import {
  applyModelOrder,
  buildTaste,
  isRecommendable,
  priceAffinity,
  rankByTaste,
  SIGNAL_WEIGHT,
  tasteTerms,
  type TasteSignal,
} from "./taste.js";
import type { Product } from "./types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

/*
 * One buyable variant by default, because that is the real shape: a product
 * with no variant cannot be priced or bought at all, and `createProduct` gives
 * every product a "Default" one for exactly that reason. The fixture started
 * with `variants: []`, which made every one of these unrecommendable the
 * moment `isRecommendable` existed — a fixture that was never a real product.
 */
function product(id: string, over: Partial<Product> = {}): Product {
  const priceRange = over.priceRange ?? { min: money("5.000"), max: money("5.000") };
  return {
    id,
    handle: id,
    title: over.title ?? id,
    description: "",
    descriptionHtml: "",
    productType: null,
    vendor: null,
    vendorBadges: [],
    tags: [],
    attributes: [],
    images: [],
    options: [],
    variants: [{
      id: `${id}-v`, title: "Default", sku: null,
      price: priceRange.min, compareAtPrice: null,
      availableForSale: true, selectedOptions: [],
    }],
    ...over,
    priceRange,
  };
}

/* A small shop with two clear worlds in it: warm homeware, and electronics. */
const catalog: Product[] = [
  product("lamp", { title: "Brass reading lamp", productType: "Lighting", vendor: "Warm Room", tags: ["brass", "home"], priceRange: { min: money("12.000"), max: money("12.000") } }),
  product("cushion", { title: "Linen cushion cover", productType: "Soft furnishing", vendor: "Warm Room", tags: ["linen", "home"], priceRange: { min: money("6.000"), max: money("6.000") } }),
  product("shade", { title: "Paper lamp shade", productType: "Lighting", vendor: "Warm Room", tags: ["home"], priceRange: { min: money("9.000"), max: money("9.000") } }),
  product("throw", { title: "Linen throw", productType: "Soft furnishing", vendor: "Other Store", tags: ["linen"], priceRange: { min: money("14.000"), max: money("14.000") } }),
  product("mouse", { title: "Gaming mouse", productType: "Peripherals", vendor: "Byte Co", tags: ["gaming"], priceRange: { min: money("22.000"), max: money("22.000") } }),
  product("rug", { title: "Hand-knotted rug", productType: "Soft furnishing", vendor: "Warm Room", tags: ["home"], priceRange: { min: money("480.000"), max: money("480.000") } }),
];

const saved = (id: string): TasteSignal => ({ productId: id, kind: "saved" });

describe("building a profile", () => {
  it("weights a purchase above a save above a follow", () => {
    expect(SIGNAL_WEIGHT.bought).toBeGreaterThan(SIGNAL_WEIGHT.bagged);
    expect(SIGNAL_WEIGHT.bagged).toBeGreaterThan(SIGNAL_WEIGHT.saved);
    expect(SIGNAL_WEIGHT.saved).toBeGreaterThan(SIGNAL_WEIGHT.followed);
  });

  it("counts a product once at its strongest kind, not once per signal", () => {
    // Saved it, bagged it, bought it — one decision about lamps, not three.
    const many = buildTaste(
      [saved("lamp"), { productId: "lamp", kind: "bagged" }, { productId: "lamp", kind: "bought" }],
      catalog,
    );
    const once = buildTaste([{ productId: "lamp", kind: "bought" }], catalog);
    expect(many.strength).toBe(once.strength);
    expect(many.strength).toBe(SIGNAL_WEIGHT.bought);
  });

  it("remembers a signal for a product that has left the shelf without learning from it", () => {
    const profile = buildTaste([saved("lamp"), saved("withdrawn")], catalog);
    expect(profile.seen.has("withdrawn")).toBe(true);
    expect(profile.strength).toBe(SIGNAL_WEIGHT.saved);
  });

  it("takes the median price, so one aspirational look does not move it", () => {
    const profile = buildTaste([saved("cushion"), saved("lamp"), saved("rug")], catalog);
    // 6, 12, 480 → 12, not the 166 a mean would give.
    expect(profile.typicalFils).toBe(12000n);
  });
});

describe("ranking", () => {
  it("puts the closest fit first and says why", () => {
    const profile = buildTaste([saved("lamp"), saved("cushion")], catalog);
    const ranked = rankByTaste(profile, catalog);

    expect(ranked[0].product.id).toBe("shade");
    expect(ranked[0].reasons.map(r => r.key)).toContain("taste.becauseType");
  });

  it("never recommends something already saved, bagged or bought", () => {
    const profile = buildTaste([saved("lamp"), saved("cushion")], catalog);
    const ids = rankByTaste(profile, catalog).map(entry => entry.product.id);
    expect(ids).not.toContain("lamp");
    expect(ids).not.toContain("cushion");
  });

  it("drops what matches nothing rather than padding the rail out", () => {
    const profile = buildTaste([saved("lamp"), saved("cushion")], catalog);
    const ids = rankByTaste(profile, catalog).map(entry => entry.product.id);
    // The gaming mouse shares no type, vendor or tag with warm homeware.
    expect(ids).not.toContain("mouse");
  });

  it("carries at most two reasons, most specific first", () => {
    const profile = buildTaste([saved("lamp"), saved("cushion")], catalog);
    for (const entry of rankByTaste(profile, catalog)) {
      expect(entry.reasons.length).toBeLessThanOrEqual(2);
      expect(entry.reasons.length).toBeGreaterThan(0);
    }
  });

  /*
   * The rug shares a type and a vendor with the profile but costs forty times
   * what this shopper looks at. It may still appear — it is genuinely related —
   * but it must not outrank the things in their actual range.
   */
  it("lets price sharpen a match without letting it decide one", () => {
    const profile = buildTaste([saved("cushion"), saved("lamp")], catalog);
    const ranked = rankByTaste(profile, catalog);
    const rug = ranked.findIndex(entry => entry.product.id === "rug");
    const shade = ranked.findIndex(entry => entry.product.id === "shade");
    expect(shade).toBeGreaterThanOrEqual(0);
    expect(rug === -1 || shade < rug).toBe(true);

    // And price alone never lifts an unrelated product into the list.
    const cheap = product("cheap-unrelated", { productType: "Peripherals", vendor: "Byte Co", priceRange: { min: money("12.000"), max: money("12.000") } });
    const ids = rankByTaste(profile, [...catalog, cheap]).map(entry => entry.product.id);
    expect(ids).not.toContain("cheap-unrelated");
  });

  it("returns nothing at all for a shopper with no signals", () => {
    expect(rankByTaste(buildTaste([], catalog), catalog)).toEqual([]);
  });

  it("is stable: equal scores break on title, not on catalog order", () => {
    const profile = buildTaste([saved("lamp")], catalog);
    const forward = rankByTaste(profile, catalog).map(e => e.product.id);
    const backward = rankByTaste(profile, [...catalog].reverse()).map(e => e.product.id);
    expect(forward).toEqual(backward);
  });
});

describe("what is worth recommending at all", () => {
  const sellable = (over: Partial<Product["variants"][number]> = {}) => ([{
    id: "v", title: "Default", sku: null, price: money("5.000"), compareAtPrice: null,
    availableForSale: true, selectedOptions: [], ...over,
  }]);

  it("refuses a sold-out product however well it matches", () => {
    const soldOut = product("sold-out-lamp", {
      productType: "Lighting", vendor: "Warm Room", tags: ["brass", "home"],
      variants: sellable({ availableForSale: false }),
    });
    expect(isRecommendable(soldOut)).toBe(false);

    const profile = buildTaste([saved("lamp"), saved("cushion")], catalog);
    const ids = rankByTaste(profile, [...catalog, soldOut]).map(e => e.product.id);
    expect(ids).not.toContain("sold-out-lamp");
  });

  /* The same rule assertPriced puts on the two doors onto the shelf. */
  it("refuses a product buyable for nothing", () => {
    const free = product("free-lamp", {
      productType: "Lighting", vendor: "Warm Room", tags: ["home"],
      variants: sellable({ price: money("0.000") }),
    });
    expect(isRecommendable(free)).toBe(false);

    const profile = buildTaste([saved("lamp"), saved("cushion")], catalog);
    expect(rankByTaste(profile, [...catalog, free]).map(e => e.product.id)).not.toContain("free-lamp");
  });

  it("keeps a product where at least one variant is buyable at a real price", () => {
    const mixed = product("mixed-lamp", {
      productType: "Lighting", vendor: "Warm Room", tags: ["home"],
      variants: [
        { id: "a", title: "Gone", sku: null, price: money("9.000"), compareAtPrice: null, availableForSale: false, selectedOptions: [] },
        { id: "b", title: "Here", sku: null, price: money("9.000"), compareAtPrice: null, availableForSale: true, selectedOptions: [] },
      ],
    });
    expect(isRecommendable(mixed)).toBe(true);
  });
});

describe("priceAffinity", () => {
  it("is 1 for the same price and falls away by ratio, not by difference", () => {
    expect(priceAffinity(10000n, 10000n)).toBe(1);
    expect(priceAffinity(2000n, 4000n)).toBeCloseTo(0.5);
    // Two dinars apart on a two-hundred-dinar item is the same shopper.
    expect(priceAffinity(200000n, 202000n)).toBeGreaterThan(0.98);
    // Two dinars apart on a two-dinar item is not.
    expect(priceAffinity(2000n, 4000n)).toBeLessThan(0.6);
  });

  it("refuses a zero or negative price rather than dividing by it", () => {
    expect(priceAffinity(0n, 5000n)).toBe(0);
    expect(priceAffinity(5000n, 0n)).toBe(0);
  });
});

describe("what leaves NetLet", () => {
  it("is interest terms and nothing that identifies anybody", () => {
    const profile = buildTaste([saved("lamp"), saved("cushion")], catalog);
    const terms = tasteTerms(profile);

    expect(terms).toContain("lighting");
    expect(terms).toContain("home");
    // Nothing here is a person: no ids, no emails, no order references.
    for (const term of terms) {
      expect(term).not.toMatch(/@/);
      expect(term).not.toMatch(/^NL-/);
    }
    expect(terms.join(" ")).not.toContain("lamp-id");
  });
});

describe("applying a model's order", () => {
  const ranked = [
    { product: product("a"), score: 3, reasons: [] },
    { product: product("b"), score: 2, reasons: [] },
    { product: product("c"), score: 1, reasons: [] },
  ];

  it("reorders to what the model asked for", () => {
    expect(applyModelOrder(ranked, ["c", "a", "b"]).map(e => e.product.id)).toEqual(["c", "a", "b"]);
  });

  /* The one that matters: a model must not be able to add a product to a shop. */
  it("drops an id it was never given, however confidently it is returned", () => {
    const out = applyModelOrder(ranked, ["not-a-product", "c", "../../etc/passwd", "a"]);
    expect(out.map(e => e.product.id)).toEqual(["c", "a", "b"]);
  });

  it("ignores a repeat rather than showing the same product twice", () => {
    expect(applyModelOrder(ranked, ["a", "a", "a"]).map(e => e.product.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps everything it omitted, in the order we already trusted", () => {
    expect(applyModelOrder(ranked, ["c"]).map(e => e.product.id)).toEqual(["c", "a", "b"]);
    expect(applyModelOrder(ranked, []).map(e => e.product.id)).toEqual(["a", "b", "c"]);
  });
});
