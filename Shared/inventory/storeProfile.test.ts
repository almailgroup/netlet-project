import { describe, expect, it } from "vitest";
import {
  GOVERNORATES,
  ibanReadAs,
  isGovernorate,
  isValidIban,
  isValidKuwaitPhone,
  missingStoreDetails,
  normaliseIban,
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

  it("reads a 0 or a 1 in a Kuwaiti bank code as the letter it must be", () => {
    // Typed from the National Bank's letter with a zero for the O: refused as
    // bad check digits before, when the digits were never the problem.
    expect(isValidIban("KW09 NB0K 0000 0000 0000 1234 5678 90")).toBe(true);
    expect(isValidIban("KW57KFH00000000000009876543210")).toBe(true);
    // A bank code is four letters, so nothing is guessed: the check digits
    // still decide, and a wrong account is still wrong.
    expect(isValidIban("KW09NB0K0000000000001234567809")).toBe(false);
  });
});

describe("normaliseIban", () => {
  it("is the IBAN as it is stored and sent", () => {
    expect(normaliseIban("kw09 nb0k 0000-0000 0000 1234 5678 90")).toBe("KW09NBOK0000000000001234567890");
    expect(normaliseIban("KW57 KFH0 0000 0000 0000 9876 5432 10")).toBe("KW57KFHO0000000000009876543210");
  });

  it("touches a digit only in a Kuwaiti bank code", () => {
    // The account part is digits that mean digits, and another country's
    // format is not this rule's to read.
    expect(normaliseIban("KW81CBKU0000000000001234560101")).toBe("KW81CBKU0000000000001234560101");
    expect(normaliseIban("DE89 3704 0044 0532 0130 00")).toBe("DE89370400440532013000");
    expect(normaliseIban("KW8")).toBe("KW8");
  });

  it("says what it changed, so the form can show it", () => {
    expect(ibanReadAs("KW09 NB0K 0000 0000 0000 1234 5678 90")).toBe("KW09NBOK0000000000001234567890");
    // Spaces and case are how people type one, not a change worth a line.
    expect(ibanReadAs("kw09 nbok 0000 0000 0000 1234 5678 90")).toBeNull();
    expect(ibanReadAs("")).toBeNull();
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
