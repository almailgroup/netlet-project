import { describe, expect, it } from "vitest";
import { needsAttention, reviewProduct, type ReviewableProduct } from "./productReview.js";

const listing = (over: Partial<ReviewableProduct> = {}): ReviewableProduct => ({
  title: "Brass Reading Lamp",
  description: "A warm brass lamp for a side table, with a dimmable bulb included.",
  categoryId: 2,
  imageCount: 3,
  prices: ["24.500"],
  ...over,
});

const findings = (product: ReviewableProduct) => reviewProduct(product).map(flag => flag.finding);

describe("a listing with nothing wrong", () => {
  it("is flagged for nothing", () => {
    expect(reviewProduct(listing())).toEqual([]);
    expect(needsAttention([])).toBe(false);
  });
});

describe("taking the shopper off the platform", () => {
  /* The order leaves NetLet's protection as well as its books. */
  it("finds a Kuwaiti number in the description, and says which", () => {
    const [flag] = reviewProduct(listing({ description: "Call 9123 4567 for a better price" }));
    expect(flag).toMatchObject({ finding: "contactInText", severity: "serious" });
    expect(flag.detail).toContain("9123 4567");
  });

  it("finds an email and a link too", () => {
    expect(findings(listing({ title: "Lamp — sales@example.com" }))).toContain("contactInText");
    expect(findings(listing({ description: "Order at www.example.com" }))).toContain("contactInText");
    expect(findings(listing({ description: "Message us on WhatsApp" }))).toContain("contactInText");
  });

  /* The contact filter reaches what the plain shapes cannot: a seller who knows
     the tricks uses them in a listing as readily as in a message. */
  it("finds a number written in Arabic digits or hidden from the plain shapes", () => {
    for (const description of ["للطلب: ٩٩٨٨ ٧٧٦٦", "Call 9\u200b9\u200b8\u200b8\u200b7\u200b7\u200b6\u200b6", "nine nine eight eight seven seven six six", "email noura at gmail dot com"]) {
      const flag = reviewProduct(listing({ description })).find(one => one.finding === "contactInText");
      expect(flag, description).toMatchObject({ severity: "serious" });
    }
  });

  it("leaves a barcode or a model number alone", () => {
    for (const description of ["Barcode 6291041500213, warranty card inside.", "Model 7840112355 replaces 7840112300", "EAN: 0012345678905"]) {
      expect(findings(listing({ description })), description).not.toContain("contactInText");
    }
  });
});

describe("claims a marketplace cannot carry", () => {
  it("flags a medical claim", () => {
    expect(findings(listing({ description: "This cream cures eczema in a week." }))).toContain("bannedClaim");
    expect(findings(listing({ description: "كريم يعالج الأكزيما" }))).toContain("bannedClaim");
  });

  /* A word list that flags "manicures" trains everybody to ignore the flags. */
  it("does not flag a word that merely contains one", () => {
    expect(findings(listing({ description: "A full set of manicures tools for home use." }))).not.toContain("bannedClaim");
  });
});

describe("what makes a listing untidy rather than wrong", () => {
  it("notices no pictures, no category and a thin description", () => {
    const flags = findings(listing({ imageCount: 0, categoryId: null, description: "A lamp." }));
    expect(flags).toEqual(expect.arrayContaining(["noImages", "noCategory", "thinDescription"]));
    expect(needsAttention(reviewProduct(listing({ imageCount: 0 })))).toBe(false);
  });

  it("notices a title shouting, and leaves a brand and a spec alone", () => {
    expect(findings(listing({ title: "BEST DEAL EVER BUY NOW" }))).toContain("shoutingTitle");
    expect(findings(listing({ title: "SONY 4K" }))).not.toContain("shoutingTitle");
  });
});

describe("the money rule the shelf already enforces", () => {
  /* Surfaced here so the queue says why a publish will be refused, rather than
     letting somebody press approve and read an error. */
  it("flags any variant priced at nothing", () => {
    expect(findings(listing({ prices: ["24.500", "0.000"] }))).toContain("zeroPrice");
    expect(needsAttention(reviewProduct(listing({ prices: ["0.000"] })))).toBe(true);
  });
});

describe("the order they are read in", () => {
  it("puts the serious findings first", () => {
    const flags = reviewProduct(listing({ imageCount: 0, description: "Call 9123 4567", prices: ["0.000"] }));
    expect(flags[0].severity).toBe("serious");
    expect(flags.at(-1)!.severity).toBe("minor");
  });
});
