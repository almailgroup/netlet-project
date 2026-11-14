import { describe, expect, it } from "vitest";
import {
  CATALOGUE_DIRECT_BYTES,
  CATALOGUE_PART_BYTES,
  MAX_CATALOGUE_BYTES,
  catalogueHref,
  catalogueName,
  cataloguePartHref,
  catalogueSizeProblem,
  catalogueTitleProblem,
  cleanCatalogueTitle,
  cleanReviewNote,
  endsLikePdf,
  isCatalogueStatus,
  partCount,
  readInParts,
  startsLikePdf,
  statusOnUpload,
} from "./productCatalogues.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("product catalogues", () => {
  it("follow the store's publish rule", () => {
    expect(statusOnUpload({ admin: true, autoPublish: false })).toBe("live");
    expect(statusOnUpload({ admin: false, autoPublish: true })).toBe("live");
    expect(statusOnUpload({ admin: false, autoPublish: false })).toBe("pending");
    expect(isCatalogueStatus("pending")).toBe(true);
    expect(isCatalogueStatus("archived")).toBe(false);
  });

  it("are a PDF by their first bytes, whole by their last", () => {
    expect(startsLikePdf(bytes("%PDF-1.7\n…"))).toBe(true);
    expect(startsLikePdf(bytes("%PDF"))).toBe(false);
    expect(startsLikePdf(bytes("<html>"))).toBe(false);
    expect(endsLikePdf(bytes("…\n%%EOF\n"))).toBe(true);
    expect(endsLikePdf(bytes("…\n%%EOF"))).toBe(true);
    expect(endsLikePdf(bytes("…\nendobj\n"))).toBe(false);
    /* Only the last kilobyte is read: an end marker further back is an earlier revision, and the file was cut after it. */
    expect(endsLikePdf(bytes(`%%EOF${" ".repeat(2000)}`))).toBe(false);
  });

  it("are at most 5 MB, sent in parts a function can take", () => {
    expect(MAX_CATALOGUE_BYTES).toBe(5 * 1024 * 1024);
    expect(CATALOGUE_PART_BYTES).toBeLessThan(4_500_000);
    expect(CATALOGUE_DIRECT_BYTES).toBeLessThan(4_500_000);
    expect(catalogueSizeProblem(0)).toBe("catalogue.empty");
    expect(catalogueSizeProblem(1.5)).toBe("catalogue.empty");
    expect(catalogueSizeProblem(MAX_CATALOGUE_BYTES)).toBeNull();
    expect(catalogueSizeProblem(MAX_CATALOGUE_BYTES + 1)).toBe("catalogue.tooLarge");
    expect(partCount(1)).toBe(1);
    expect(partCount(CATALOGUE_PART_BYTES)).toBe(1);
    expect(partCount(CATALOGUE_PART_BYTES + 1)).toBe(2);
    expect(partCount(MAX_CATALOGUE_BYTES)).toBe(2);
    expect(readInParts(CATALOGUE_DIRECT_BYTES)).toBe(false);
    expect(readInParts(CATALOGUE_DIRECT_BYTES + 1)).toBe(true);
  });

  it("keep a title clean and free of contact details", () => {
    expect(cleanCatalogueTitle("  Lamp​   brochure\n2026 ")).toBe("Lamp brochure 2026");
    expect(cleanCatalogueTitle("   ")).toBeNull();
    expect(cleanCatalogueTitle(null)).toBeNull();
    expect(cleanCatalogueTitle("x".repeat(300))).toHaveLength(120);
    expect(catalogueTitleProblem("User manual, 2026 edition")).toBeNull();
    expect(catalogueTitleProblem("Call ٩٩٨٨٧٧٦٦")).toBe("catalogue.offPlatform");
    expect(catalogueTitleProblem("shop at acme.com")).toBe("catalogue.offPlatform");
    expect(cleanReviewNote(" Shows a phone number ")).toBe("Shows a phone number");
    expect(cleanReviewNote("")).toBeNull();
  });

  it("are named by the page's language, then the other, then the file", () => {
    const both = { title: "Brochure", titleAr: "كتيّب", fileName: "a.pdf" };
    expect(catalogueName(both, "en")).toBe("Brochure");
    expect(catalogueName(both, "ar")).toBe("كتيّب");
    expect(catalogueName({ ...both, titleAr: null }, "ar")).toBe("Brochure");
    expect(catalogueName({ title: null, titleAr: null, fileName: "Lamp manual.PDF" }, "en")).toBe("Lamp manual");
    expect(catalogueHref(4)).toBe("/api/catalogues/4");
    expect(catalogueHref(4, true)).toBe("/api/catalogues/4?download=1");
    expect(cataloguePartHref(4, 1)).toBe("/api/catalogues/4?part=1");
  });
});
