import { describe, expect, it } from "vitest";
import {
  CLAIM_HOLD_DAYS,
  claimStateFor,
  formatPhone,
  giftLookup,
  LOOKUP_NAME_MAX,
  giftableNow,
  normalisePhone,
  shareable,
} from "./wishlist.js";
import type { Product } from "./types.js";

const money = (amount: string) => ({ amount, currencyCode: "KWD" });

function product(over: Partial<Product> = {}): Product {
  return {
    id: "1", handle: "p", title: "P", description: "", descriptionHtml: "",
    productType: null, vendor: null, vendorBadges: [], tags: [], attributes: [],
    images: [], options: [], priceRange: { min: money("5.000"), max: money("5.000") },
    variants: [{
      id: "v", title: "Default", sku: null, price: money("5.000"), compareAtPrice: null,
      availableForSale: true, selectedOptions: [],
    }],
    ...over,
  };
}

describe("the phone key", () => {
  /*
   * The spellings one family actually types between them. Every one of these
   * is the same person, and a lookup that finds them at one and not another
   * reads as a broken feature rather than as somebody having typed a space.
   */
  it("puts every spelling of one number under one key", () => {
    const same = [
      "+965 5012 3456",
      "+96550123456",
      "00965 50123456",
      "965-5012-3456",
      "50123456",
      "5012 3456",
      "  (+965) 5012-3456  ",
    ];
    for (const spelling of same) expect(normalisePhone(spelling)).toBe("+96550123456");
  });

  /* An Arabic keyboard is the obvious way to type a number on an Arabic page. */
  it("reads Arabic-Indic digits as the same number", () => {
    expect(normalisePhone("٥٠١٢٣٤٥٦")).toBe("+96550123456");
    expect(normalisePhone("+٩٦٥ ٥٠١٢ ٣٤٥٦")).toBe("+96550123456");
    // Extended Arabic-Indic, which Persian and Urdu keyboards send.
    expect(normalisePhone("۵۰۱۲۳۴۵۶")).toBe("+96550123456");
  });

  it("refuses what is not a Kuwait number rather than guessing at one", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone("5012345")).toBeNull();        // seven digits
    expect(normalisePhone("501234567")).toBeNull();      // nine
    expect(normalisePhone("not a number")).toBeNull();
    expect(normalisePhone("+44 20 7946 0958")).toBeNull();
  });

  /* Null is a refusal, and refusing must never be confused with a real key. */
  it("never returns a key for junk, however long the junk is", () => {
    expect(normalisePhone("--------")).toBeNull();
    expect(normalisePhone("+965")).toBeNull();
  });

  it("shows a number back the way somebody would read it aloud", () => {
    expect(formatPhone("+96550123456")).toBe("5012 3456");
  });
});

describe("publishing", () => {
  it("shares only what the owner published", () => {
    expect(shareable({ visibility: "public" })).toBe(true);
    expect(shareable({ visibility: "private" })).toBe(false);
  });
});

describe("claims", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  it("is available with nothing on it", () => {
    expect(claimStateFor({}, now)).toBe("available");
  });

  it("holds a fresh claim so two relatives do not buy one lamp", () => {
    expect(claimStateFor({ claimedAt: daysAgo(1) }, now)).toBe("claimed");
  });

  /* An aunt who pressed the button and forgot must not block it forever. */
  it("lets an abandoned claim lapse", () => {
    expect(claimStateFor({ claimedAt: daysAgo(CLAIM_HOLD_DAYS - 1) }, now)).toBe("claimed");
    expect(claimStateFor({ claimedAt: daysAgo(CLAIM_HOLD_DAYS + 1) }, now)).toBe("available");
  });

  /* Money changed hands. Nothing about that expires. */
  it("never lapses a purchase, however old", () => {
    expect(claimStateFor({ boughtAt: daysAgo(400) }, now)).toBe("bought");
    expect(claimStateFor({ claimedAt: daysAgo(400), boughtAt: daysAgo(399) }, now)).toBe("bought");
  });

  it("reads a stored timestamp string the same as a Date", () => {
    expect(claimStateFor({ claimedAt: daysAgo(1).toISOString() }, now)).toBe("claimed");
    expect(claimStateFor({ claimedAt: "not a date" }, now)).toBe("available");
  });
});

describe("what can actually be bought", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("refuses something already claimed or bought", () => {
    expect(giftableNow(product(), { claimedAt: now }, now)).toBe(false);
    expect(giftableNow(product(), { boughtAt: now }, now)).toBe(false);
    expect(giftableNow(product(), {}, now)).toBe(true);
  });

  /* The same two refusals the recommender makes, at a third door. */
  it("refuses a sold-out product and one priced at nothing", () => {
    const soldOut = product({ variants: [{ id: "v", title: "D", sku: null, price: money("5.000"), compareAtPrice: null, availableForSale: false, selectedOptions: [] }] });
    const free = product({ variants: [{ id: "v", title: "D", sku: null, price: money("0.000"), compareAtPrice: null, availableForSale: true, selectedOptions: [] }] });
    expect(giftableNow(soldOut, {}, now)).toBe(false);
    expect(giftableNow(free, {}, now)).toBe(false);
  });

  it("keeps a product where one variant is buyable at a real price", () => {
    const mixed = product({ variants: [
      { id: "a", title: "Gone", sku: null, price: money("9.000"), compareAtPrice: null, availableForSale: false, selectedOptions: [] },
      { id: "b", title: "Here", sku: null, price: money("9.000"), compareAtPrice: null, availableForSale: true, selectedOptions: [] },
    ] });
    expect(giftableNow(mixed, {}, now)).toBe(true);
  });
});

describe("giftLookup", () => {
  it("reads a Kuwaiti number first, in any digits", () => {
    expect(giftLookup("5012 3456")).toEqual({ phone: "5012 3456" });
    expect(giftLookup("+965 5012 3456")).toEqual({ phone: "+965 5012 3456" });
    expect(giftLookup("٥٠١٢٣٤٥٦")).toEqual({ phone: "٥٠١٢٣٤٥٦" });
  });

  it("reads anything else with a letter in it as a name, its spaces tidied", () => {
    expect(giftLookup("  Noura   Al-Sabah ")).toEqual({ name: "Noura Al-Sabah" });
    expect(giftLookup("نورة")).toEqual({ name: "نورة" });
    expect(giftLookup("Noura2024")).toEqual({ name: "Noura2024" });
  });

  it("refuses a single letter, a short number and nothing at all", () => {
    expect(giftLookup("N")).toBeNull();
    expect(giftLookup("1234")).toBeNull();
    expect(giftLookup("--")).toBeNull();
    expect(giftLookup("")).toBeNull();
    expect(giftLookup(undefined)).toBeNull();
    expect(giftLookup("a".repeat(LOOKUP_NAME_MAX + 1))).toBeNull();
  });
});
