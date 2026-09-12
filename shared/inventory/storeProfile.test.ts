import { describe, expect, it } from "vitest";
import {
  GOVERNORATES,
  isGovernorate,
  isValidIban,
  isValidKuwaitPhone,
  missingStoreDetails,
  storeSlug,
} from "./storeProfile.js";
import { kuwaitDeliveryZones } from "../customer.js";

describe("storeSlug", () => {
  it("turns a store name into a URL-safe slug", () => {
    expect(storeSlug("Al Mail Group")).toBe("al-mail-group");
    expect(storeSlug("Home & Kitchen Co.")).toBe("home-and-kitchen-co");
  });

  it("returns empty rather than a fallback when nothing survives", () => {
    // The point of the difference from `categorySlug`: a store quietly named
    // after a fallback is a store nobody can find again.
    expect(storeSlug("متجر")).toBe("");
    expect(storeSlug("   ")).toBe("");
  });

  it("does not leave stray separators at either end", () => {
    expect(storeSlug("  --Bright Store--  ")).toBe("bright-store");
  });
});

describe("isValidIban", () => {
  it("accepts a correct Kuwaiti IBAN", () => {
    expect(isValidIban("KW81CBKU0000000000001234560101")).toBe(true);
  });

  it("ignores spacing and case, which is how people type one", () => {
    expect(isValidIban("kw81 cbku 0000 0000 0000 1234 5601 01")).toBe(true);
  });

  it("rejects a transposition the check digits are there to catch", () => {
    // Two digits swapped: same length, same prefix, still wrong.
    expect(isValidIban("KW81CBKU0000000000001234565001")).toBe(false);
  });

  it("rejects the obvious rubbish", () => {
    expect(isValidIban("")).toBe(false);
    expect(isValidIban("1234567890")).toBe(false);
    expect(isValidIban("KW81")).toBe(false);
  });
});

describe("isValidKuwaitPhone", () => {
  it("takes eight digits, with or without the country code", () => {
    expect(isValidKuwaitPhone("55123456")).toBe(true);
    expect(isValidKuwaitPhone("+965 5512 3456")).toBe(true);
    expect(isValidKuwaitPhone("965-55123456")).toBe(true);
  });

  it("rejects a wrong length", () => {
    expect(isValidKuwaitPhone("5512345")).toBe(false);
    expect(isValidKuwaitPhone("551234567")).toBe(false);
  });
});

describe("missingStoreDetails", () => {
  it("names every blank field, in the order the form shows them", () => {
    expect(missingStoreDetails({})).toEqual([
      "contactEmail", "contactPhone", "governorate", "addressLine", "licenceNumber", "payoutIban",
    ]);
  });

  it("treats whitespace as blank", () => {
    expect(missingStoreDetails({ contactEmail: "   " })).toContain("contactEmail");
  });

  it("is empty once the store is complete", () => {
    expect(missingStoreDetails({
      contactEmail: "shop@example.com",
      contactPhone: "55123456",
      governorate: "hawalli",
      addressLine: "Block 4, Street 12",
      licenceNumber: "0012345",
      payoutIban: "KW81CBKU0000000000001234560101",
    })).toEqual([]);
  });
});

describe("governorates", () => {
  it("are exactly the delivery zones the storefront offers", () => {
    // Compared against the real list rather than counted: a governorate the
    // shop cannot deliver to is a store address nothing can ship from, and a
    // length assertion would sail straight past a renamed zone.
    expect([...GOVERNORATES]).toEqual(kuwaitDeliveryZones.map(zone => zone.id));
  });

  it("recognises one of them and nothing else", () => {
    expect(isGovernorate("hawalli")).toBe(true);
    expect(isGovernorate("london")).toBe(false);
  });
});
